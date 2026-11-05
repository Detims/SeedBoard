import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, realpath, rename, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { isSafeRelativePath } from "@modernizer/discovery";

const execFileAsync = promisify(execFile);
const maxGitOutputBytes = 8 * 1024 * 1024;
const revisionPattern = /^[a-f0-9]{40,64}$/i;

export type RepositoryFileChange = { path: string; status: string; restorable: boolean };
export type RepositoryChanges = {
  available: boolean;
  reason: string | null;
  sourceRevision: string | null;
  currentRevision: string | null;
  changeToken: string | null;
  files: RepositoryFileChange[];
};

export class RepositoryRestoreConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryRestoreConflict";
  }
}

export async function captureRepositoryRevision(rootPath: string): Promise<string | null> {
  try {
    const revision = await gitText(rootPath, ["rev-parse", "--verify", "HEAD"]);
    return revisionPattern.test(revision.trim()) ? revision.trim() : null;
  } catch {
    return null;
  }
}

export async function inspectRepositoryChanges(
  rootPath: string,
  sourceRevision: string | null,
): Promise<RepositoryChanges> {
  if (!sourceRevision || !revisionPattern.test(sourceRevision)) {
    return unavailable("This scan did not record a Git commit to compare against.", sourceRevision);
  }

  try {
    const currentRevision = (await gitText(rootPath, ["rev-parse", "--verify", "HEAD"])).trim();
    if (!revisionPattern.test(currentRevision)) {
      return unavailable(
        "The selected folder does not have a readable Git commit.",
        sourceRevision,
      );
    }
    await gitText(rootPath, ["cat-file", "-e", `${sourceRevision}^{commit}`]);
    const names = await gitBuffer(rootPath, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "--no-renames",
      "-z",
      sourceRevision,
      "--",
      ".",
    ]);
    const patch = await gitBuffer(rootPath, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--binary",
      "--no-renames",
      sourceRevision,
      "--",
      ".",
    ]);
    const staged = new Set(
      parseNullSeparatedPaths(
        await gitBuffer(rootPath, ["diff", "--cached", "--name-only", "-z", "--"]),
      ),
    );
    const files = parseNameStatus(names).map((file) => ({
      ...file,
      restorable: !staged.has(file.path),
    }));
    return {
      available: true,
      reason: null,
      sourceRevision,
      currentRevision,
      changeToken: createHash("sha256").update(patch).digest("hex"),
      files,
    };
  } catch {
    return unavailable(
      "Git change details are unavailable. Check that Git is installed and the scan commit still exists.",
      sourceRevision,
    );
  }
}

export async function restoreRepositoryFiles(
  rootPath: string,
  sourceRevision: string | null,
  input: { currentRevision: string; changeToken: string; paths: string[] },
): Promise<string[]> {
  if (!sourceRevision || !revisionPattern.test(sourceRevision)) {
    throw new RepositoryRestoreConflict("This scan has no Git commit that can be restored.");
  }
  if (!revisionPattern.test(input.currentRevision)) {
    throw new TypeError("The current Git commit is invalid.");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.changeToken)) {
    throw new TypeError("The repository change confirmation is invalid.");
  }
  if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100) {
    throw new TypeError("Select between 1 and 100 changed files to restore.");
  }
  const paths = [...new Set(input.paths)];
  if (paths.length !== input.paths.length || paths.some((path) => !isSafeRelativePath(path))) {
    throw new TypeError("The selected file paths are unsafe or duplicated.");
  }

  const state = await inspectRepositoryChanges(rootPath, sourceRevision);
  if (!state.available || !state.currentRevision || !state.changeToken) {
    throw new RepositoryRestoreConflict(state.reason ?? "Repository state is unavailable.");
  }
  if (state.currentRevision !== input.currentRevision || state.changeToken !== input.changeToken) {
    throw new RepositoryRestoreConflict(
      "Repository files changed after the preview. Review the refreshed list before restoring.",
    );
  }
  const changed = new Set(state.files.map(({ path }) => path));
  if (paths.some((path) => !changed.has(path))) {
    throw new RepositoryRestoreConflict(
      "Every selected file must still be changed since this scan.",
    );
  }

  const staged = await gitBuffer(rootPath, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--",
    ...paths,
  ]);
  if (staged.length > 0) {
    throw new RepositoryRestoreConflict(
      "A selected file has staged changes. Unstage or commit it before restoring.",
    );
  }

  const actions: Array<{ path: string; entry: TreeEntry | null; bytes: Buffer | null }> = [];
  let totalBytes = 0;
  for (const path of paths) {
    const entries = await gitBuffer(rootPath, ["ls-tree", "-z", sourceRevision, "--", path]);
    const entry = parseTreeEntry(entries, path);
    if (entry?.mode === "120000") {
      throw new RepositoryRestoreConflict(
        `"${path}" is a symbolic link and cannot be restored here.`,
      );
    }
    let bytes: Buffer | null = null;
    if (entry) {
      await gitText(rootPath, ["cat-file", "-e", `${entry.objectId}^{blob}`]);
      bytes = await gitBuffer(rootPath, ["cat-file", "blob", entry.objectId]);
      totalBytes += bytes.length;
      if (bytes.length > 5 * 1024 * 1024 || totalBytes > 25 * 1024 * 1024) {
        throw new RepositoryRestoreConflict("The selected files are too large to restore safely.");
      }
    }
    await assertSafeRestoreTarget(rootPath, path, entry !== null);
    actions.push({ path, entry, bytes });
  }

  // Read all source blobs before writing so invalid paths or unsupported files cannot cause a partial restore.
  for (const action of actions) {
    if (!action.entry || !action.bytes) await removeTrackedFile(rootPath, action.path);
    else await writeTrackedFile(rootPath, action.path, action.bytes, action.entry.mode);
  }
  return paths;
}

type TreeEntry = { mode: string; objectId: string };

function parseTreeEntry(output: Buffer, requestedPath: string): TreeEntry | null {
  const text = output.toString("utf8").replace(/\0$/, "");
  if (!text) return null;
  const separator = text.indexOf("\t");
  if (separator < 0)
    throw new RepositoryRestoreConflict("The selected file is not in the scan commit.");
  const metadata = text.slice(0, separator).split(" ");
  const path = text.slice(separator + 1);
  if (path !== requestedPath || metadata.length !== 3 || metadata[1] !== "blob") {
    throw new RepositoryRestoreConflict("The selected path is not a regular Git file.");
  }
  return { mode: metadata[0]!, objectId: metadata[2]! };
}

async function assertSafeRestoreTarget(
  rootPath: string,
  relativePath: string,
  restoreFile: boolean,
): Promise<void> {
  const root = await realpath(rootPath);
  const destination = resolve(root, relativePath);
  const rel = relative(root, destination);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TypeError("The selected file path is outside the registered project.");
  }
  let parent = root;
  for (const segment of rel.split(sep).slice(0, -1)) {
    parent = resolve(parent, segment);
    const info = await lstat(parent).catch(() => null);
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new RepositoryRestoreConflict("A parent directory is not a safe regular directory.");
    }
  }
  const info = await lstat(destination).catch(() => null);
  if (!info) return;
  if (restoreFile ? info.isSymbolicLink() || !info.isFile() : info.isDirectory()) {
    throw new RepositoryRestoreConflict("A selected path is not a safe regular file.");
  }
}

async function writeTrackedFile(
  rootPath: string,
  relativePath: string,
  bytes: Buffer,
  mode: string,
): Promise<void> {
  // This API only restores regular blobs. Symlinks are left untouched for a manual recovery.
  if (mode === "120000") {
    throw new RepositoryRestoreConflict(
      `"${relativePath}" is a symbolic link and cannot be restored here.`,
    );
  }
  const root = await realpath(rootPath);
  const destination = resolve(root, relativePath);
  const rel = relative(root, destination);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TypeError("The selected file path is outside the registered project.");
  }
  const segments = rel.split(sep);
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = resolve(parent, segment);
    try {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new RepositoryRestoreConflict("A parent directory is not a safe regular directory.");
      }
    } catch (error) {
      if (error instanceof RepositoryRestoreConflict) throw error;
      await mkdir(parent);
    }
  }
  try {
    const current = await lstat(destination);
    if (current.isSymbolicLink() || !current.isFile()) {
      throw new RepositoryRestoreConflict("A selected path is no longer a regular file.");
    }
  } catch (error) {
    if (error instanceof RepositoryRestoreConflict) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = resolve(dirname(destination), `.seedboard-restore-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", mode === "100755" ? 0o755 : 0o644);
  try {
    await file.writeFile(bytes);
    await file.close();
    await rename(temporary, destination);
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

async function removeTrackedFile(rootPath: string, relativePath: string): Promise<void> {
  const root = await realpath(rootPath);
  const destination = resolve(root, relativePath);
  const rel = relative(root, destination);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TypeError("The selected file path is outside the registered project.");
  }
  let parent = root;
  for (const segment of rel.split(sep).slice(0, -1)) {
    parent = resolve(parent, segment);
    const info = await lstat(parent).catch(() => null);
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new RepositoryRestoreConflict("A parent directory is not a safe regular directory.");
    }
  }
  const info = await lstat(destination).catch(() => null);
  if (!info) return;
  if (info.isDirectory()) {
    throw new RepositoryRestoreConflict("A selected file path is now a directory.");
  }
  await unlink(destination);
}

function parseNameStatus(output: Buffer): RepositoryFileChange[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const fields = output.toString("binary").split("\0").filter(Boolean);
  const result: RepositoryFileChange[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    try {
      const status = decoder.decode(Buffer.from(fields[index] ?? "", "binary"));
      const path = decoder.decode(Buffer.from(fields[index + 1] ?? "", "binary"));
      if (!status || !path || !isSafeRelativePath(path)) continue;
      result.push({ path, status, restorable: true });
    } catch {
      // Paths that cannot be represented safely in the dashboard remain unavailable.
    }
  }
  return result;
}

function parseNullSeparatedPaths(output: Buffer): string[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index <= output.length; index += 1) {
    if (index !== output.length && output[index] !== 0) continue;
    if (index > start) {
      try {
        const path = decoder.decode(output.subarray(start, index));
        if (isSafeRelativePath(path)) paths.push(path);
      } catch {
        // Paths outside UTF-8 remain unavailable for safe restore.
      }
    }
    start = index + 1;
  }
  return paths;
}

function unavailable(reason: string, sourceRevision: string | null): RepositoryChanges {
  return {
    available: false,
    reason,
    sourceRevision,
    currentRevision: null,
    changeToken: null,
    files: [],
  };
}

async function gitText(rootPath: string, args: string[]): Promise<string> {
  const result = await git(rootPath, args);
  return result.toString("utf8");
}

async function gitBuffer(rootPath: string, args: string[]): Promise<Buffer> {
  return git(rootPath, args);
}

async function git(rootPath: string, args: string[]): Promise<Buffer> {
  const commandArgs = [
    "--literal-pathspecs",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "--no-optional-locks",
    ...args,
  ];
  const result = await execFileAsync("git", commandArgs, {
    cwd: rootPath,
    encoding: "buffer",
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: maxGitOutputBytes,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout as Buffer;
}
