import {
  addComponent,
  addCoverage,
  addEvidence,
  addIssue,
  stableId,
  type CollectorSink,
} from "./shared.js";
import type { ConfigCollection } from "./collect-config.js";
import { isSafeRelativePath, type SafeSource } from "./safe-source.js";

const migrationSuffix = /\.(?:sql|js|cjs|mjs|ts|json)$/i;
const commonMigrationDirectory = /(?:^|\/)(?:migrations?|prisma\/migrations|db\/migrate)$/i;

export function collectMigrationFiles(
  source: SafeSource,
  sink: CollectorSink,
  config: ConfigCollection,
  selectedCollectors: ReadonlySet<string> | null,
): void {
  const collector = "migration-files" as const;
  if (selectedCollectors && !selectedCollectors.has(collector)) {
    addCoverage(
      sink,
      collector,
      "not_configured",
      "Migration files",
      "Disabled by project configuration.",
    );
    return;
  }

  const paths = source.paths().filter((path) => !ignoredByConfig(path, config.ignorePatterns));
  const configured = config.migrationDirectories;
  const discoveredDirectories = new Set<string>(configured);
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    for (let length = 1; length <= parts.length; length += 1) {
      const directory = parts.slice(0, length).join("/");
      if (commonMigrationDirectory.test(directory)) discoveredDirectories.add(directory);
    }
  }
  const migrationFiles = paths.filter((path) => {
    if (!migrationSuffix.test(path)) return false;
    return [...discoveredDirectories].some((directory) => path.startsWith(`${directory}/`));
  });

  for (const directory of discoveredDirectories) {
    if (!isSafeRelativePath(directory) && directory !== ".") {
      addIssue(
        sink,
        collector,
        "invalid_config",
        null,
        "Unsafe migration directory declaration was ignored.",
      );
    }
  }
  for (const path of migrationFiles) {
    const evidenceId = addEvidence(
      sink,
      "file",
      path,
      null,
      "Migration file inventory based on its safe relative path; file contents were not read.",
    );
    const id = stableId("component", sink.projectId, "migration", path);
    const basename = path.slice(path.lastIndexOf("/") + 1);
    addComponent(
      sink,
      {
        id,
        kind: "migration",
        layer: "data",
        name: basename.slice(0, 200),
        locator: path,
        environmentIds: [],
        versions: [],
        observations: [
          {
            dimension: "migration",
            state: "unknown",
            environmentId: null,
            observedAt: sink.capturedAt,
            confidence: "low",
            evidenceIds: [evidenceId],
          },
        ],
        evidenceIds: [evidenceId],
      },
      collector,
    );
  }

  if (configured.length > 0 || migrationFiles.length > 0) {
    addCoverage(
      sink,
      collector,
      "supported",
      "Migration file inventory",
      "Detected migration filenames only; applied status and target database state remain unknown.",
    );
  } else {
    addCoverage(
      sink,
      collector,
      "not_configured",
      "Migration file inventory",
      "No known migration directory was declared or found.",
    );
  }
}

function ignoredByConfig(path: string, patterns: string[]): boolean {
  let ignored = false;
  for (const entry of patterns) {
    const exclude = entry.startsWith("!");
    const pattern = exclude ? entry.slice(1) : entry;
    if (matchesGlob(path, pattern)) ignored = !exclude;
  }
  return ignored;
}

function matchesGlob(path: string, pattern: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`).test(path);
}
