import * as nodeFs from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_SCAN_BUDGETS,
  type DirEntryLike,
  type DiscoveryFileSystem,
  type FileStatLike,
  type ScanBudgets,
} from "./types.js";

const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  ".vite",
  ".cache",
  ".pnpm-store",
  ".modernizer-local",
  "node_modules",
  "bower_components",
  "coverage",
  "dist",
  "build",
  "out",
  "vendor",
]);

const excludedNames = new Set([
  ".npmrc",
  ".yarnrc",
  ".netrc",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "terraform.tfstate",
  "terraform.tfstate.backup",
]);

const secretExtensions = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".cer",
  ".crt",
]);

const normaliseRelative = (path: string): string => path.split(sep).join("/");

export function isExcludedPath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  return segments.some((segment, index) => {
    const lower = segment.toLowerCase();
    const basename = index === segments.length - 1;
    if (!basename && ignoredDirectories.has(lower)) return true;
    if (!basename) return false;
    return (
      lower === ".env" ||
      lower.startsWith(".env.") ||
      lower.startsWith(".env-") ||
      excludedNames.has(lower) ||
      secretExtensions.has(segment.slice(segment.lastIndexOf(".")).toLowerCase()) ||
      lower.endsWith(".secret") ||
      lower.endsWith(".tfstate")
    );
  });
}

function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function safeErrorCode(): string {
  // Filesystem errors can contain absolute paths, so only a short code is exposed.
  return "READ_FAILED";
}

export class SafeSource {
  readonly rootPath: string;
  readonly budgets: ScanBudgets;
  private readonly fileSystem: DiscoveryFileSystem;
  private readonly signal?: AbortSignal;
  private fileCount = 0;
  private totalBytes = 0;
  private readonly files = new Map<string, { absolutePath: string; size: number }>();
  private limitIssue: {
    code: "limit_files" | "limit_depth" | "read_failed";
    path: string;
  } | null = null;

  private constructor(
    rootPath: string,
    fileSystem: DiscoveryFileSystem,
    budgets: ScanBudgets,
    signal?: AbortSignal,
  ) {
    this.rootPath = rootPath;
    this.fileSystem = fileSystem;
    this.budgets = budgets;
    this.signal = signal;
  }

  static async open(options: {
    rootPath: string;
    budgets?: Partial<ScanBudgets>;
    signal?: AbortSignal;
    fileSystem?: DiscoveryFileSystem;
  }): Promise<SafeSource> {
    const fileSystem = options.fileSystem ?? (nodeFs as unknown as DiscoveryFileSystem);
    const budgets: ScanBudgets = { ...DEFAULT_SCAN_BUDGETS, ...options.budgets };
    const requested = resolve(options.rootPath);
    const rootPath = await fileSystem.realpath(requested);
    const rootStat = await fileSystem.stat(rootPath);
    if (!rootStat.isDirectory()) throw new TypeError("Selected repository root is not a directory.");
    return new SafeSource(rootPath, fileSystem, budgets, options.signal);
  }

  async walk(): Promise<{
    files: ReadonlyMap<string, { absolutePath: string; size: number }>;
    issue: { code: "limit_files" | "limit_depth"; path: string } | null;
  }> {
    await this.visit(this.rootPath, "", 0);
    return { files: this.files, issue: this.limitIssue };
  }

  has(relativePath: string): boolean {
    return this.files.has(relativePath);
  }

  paths(): string[] {
    return [...this.files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async read(relativePath: string): Promise<Uint8Array> {
    this.throwIfAborted();
    if (!isSafeRelativePath(relativePath) || isExcludedPath(relativePath)) {
      throw new TypeError("Requested path is outside the supported scan input.");
    }
    const known = this.files.get(relativePath);
    if (!known) throw new TypeError("Requested file was not inventoried by the bounded walker.");
    if (known.size > this.budgets.maxFileBytes) {
      throw new RangeError("File exceeds the configured scan size limit.");
    }
    if (this.totalBytes + known.size > this.budgets.maxTotalBytes) {
      throw new RangeError("Project exceeds the configured cumulative scan size limit.");
    }
    const resolved = await this.fileSystem.realpath(known.absolutePath);
    if (!isWithinRoot(this.rootPath, resolved)) {
      throw new TypeError("Resolved file is outside the selected repository root.");
    }
    const stat = await this.fileSystem.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TypeError("Resolved scan input is not a regular file.");
    }
    const bytes = await this.fileSystem.readFile(resolved);
    if (bytes.byteLength > this.budgets.maxFileBytes) {
      throw new RangeError("File exceeds the configured scan size limit.");
    }
    if (this.totalBytes + bytes.byteLength > this.budgets.maxTotalBytes) {
      throw new RangeError("Project exceeds the configured cumulative scan size limit.");
    }
    this.totalBytes += bytes.byteLength;
    return bytes;
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw new DOMException("Scan cancelled.", "AbortError");
  }

  private async visit(directoryPath: string, relativeDirectory: string, depth: number): Promise<void> {
    this.throwIfAborted();
    if (this.limitIssue) return;
    if (depth > this.budgets.maxDepth) {
      this.limitIssue = { code: "read_failed", path: relativeDirectory };
      return;
    }

    let entries: DirEntryLike[];
    try {
      entries = await this.fileSystem.readdir(directoryPath);
    } catch {
      // An unreadable subtree is surfaced by the caller as a bounded traversal issue.
      this.limitIssue = { code: "limit_depth", path: relativeDirectory };
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      this.throwIfAborted();
      if (this.limitIssue) return;
      const childRelative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isExcludedPath(childRelative)) continue;
      const absolutePath = resolve(directoryPath, entry.name);

      let stat: FileStatLike;
      try {
        stat = await this.fileSystem.lstat(absolutePath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;

      let realPath: string;
      try {
        realPath = await this.fileSystem.realpath(absolutePath);
      } catch {
        continue;
      }
      if (!isWithinRoot(this.rootPath, realPath)) continue;

      if (stat.isDirectory() && entry.isDirectory()) {
        if (depth + 1 > this.budgets.maxDepth) {
        this.limitIssue = { code: "limit_depth", path: childRelative };
          return;
        }
        await this.visit(realPath, childRelative, depth + 1);
        continue;
      }
      if (!stat.isFile() || !entry.isFile()) continue;
      this.fileCount += 1;
      if (this.fileCount > this.budgets.maxFiles) {
        this.limitIssue = { code: "limit_files", path: childRelative };
        return;
      }
      this.files.set(normaliseRelative(childRelative), { absolutePath: realPath, size: stat.size });
    }
  }
}

export function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export const fileUrlForPath = (absolutePath: string): string => pathToFileURL(absolutePath).href;
