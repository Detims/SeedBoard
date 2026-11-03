import {
  DEFAULT_SCAN_BUDGETS,
  type DiscoveryFacts,
  type DiscoveryResult,
  type ScanProjectOptions,
} from "./types.js";
import { SafeSource } from "./safe-source.js";
import { addCoverage, addIssue, type CollectorSink } from "./shared.js";
import { collectProjectConfig } from "./collect-config.js";
import { collectGitHubActions, collectNodeManifests, collectNpmLock } from "./collect-node.js";
import { collectMigrationFiles } from "./collect-migrations.js";

export class DiscoveryError extends Error {
  constructor(
    readonly code: "root_invalid" | "scan_cancelled",
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export async function scanProject(options: ScanProjectOptions): Promise<DiscoveryResult> {
  const projectId = options.projectId;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(projectId)) {
    throw new TypeError("Project ID is not a valid contract identifier.");
  }
  const clock = options.clock ?? (() => new Date());
  const captured = clock();
  if (!Number.isFinite(captured.getTime()))
    throw new TypeError("Injected scan clock returned an invalid date.");
  const capturedAt = captured.toISOString();
  const budgets = { ...DEFAULT_SCAN_BUDGETS, ...options.budgets };
  const sourceRevision = options.sourceRevision ?? null;

  let source: SafeSource;
  try {
    source = await SafeSource.open({
      rootPath: options.rootPath,
      budgets,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
    });
  } catch {
    if (options.signal?.aborted)
      throw new DiscoveryError("scan_cancelled", "Scan cancelled before collection began.");
    throw new DiscoveryError(
      "root_invalid",
      "Selected repository root could not be safely opened.",
    );
  }

  let walkResult: Awaited<ReturnType<SafeSource["walk"]>>;
  try {
    walkResult = await source.walk();
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new DiscoveryError("scan_cancelled", "Scan cancelled during bounded traversal.");
    }
    throw error;
  }

  const sink: CollectorSink = {
    projectId,
    capturedAt,
    budgets,
    environments: [],
    components: [],
    relationships: [],
    evidence: [],
    coverage: [],
    issues: [],
  };
  if (walkResult.issue) {
    addCoverage(
      sink,
      "safe-walk",
      "failed",
      "Repository file inventory",
      "Bounded traversal stopped before reaching the entire repository.",
    );
    const messages = {
      limit_files: "Eligible file-count limit reached.",
      limit_depth: "Directory depth limit reached.",
      read_failed: "A directory could not be enumerated safely.",
    };
    addIssue(
      sink,
      "safe-walk",
      walkResult.issue.code,
      walkResult.issue.path || null,
      messages[walkResult.issue.code],
    );
  } else {
    addCoverage(
      sink,
      "safe-walk",
      "supported",
      "Repository file inventory",
      "Inventoried bounded relative paths without executing project code.",
    );
  }

  const config = await collectProjectConfig(source, sink, null);
  const selected = config.config?.collectors.length ? new Set(config.config.collectors) : null;
  const facts: DiscoveryFacts = {
    workspaces: [],
    dependencies: [],
    workflows: [],
    coverage: {
      workspaceManifestsComplete: false,
      dependencyResolutionComplete: false,
      workflowsComplete: false,
    },
    documentationHints: config.documentationHints,
  };

  const manifestResult = await collectNodeManifests(source, sink, facts, config, selected);
  facts.coverage.workspaceManifestsComplete =
    manifestResult.supported && !sink.issues.some((item) => item.collector === "node-manifests");

  await collectNpmLock(source, sink, facts, config, manifestResult, selected);
  facts.coverage.dependencyResolutionComplete =
    sink.coverage.some((item) => item.collector === "npm-lock" && item.status === "supported") &&
    !sink.issues.some((item) => item.collector === "npm-lock");

  await collectGitHubActions(source, sink, facts, config, selected);
  facts.coverage.workflowsComplete = facts.workflows.every(
    (workflow) => workflow.parseStatus === "complete",
  );

  collectMigrationFiles(source, sink, config, selected);

  if (walkResult.issue) {
    facts.coverage.workspaceManifestsComplete = false;
    facts.coverage.dependencyResolutionComplete = false;
    facts.coverage.workflowsComplete = false;
  }
  if (options.signal?.aborted)
    throw new DiscoveryError(
      "scan_cancelled",
      "Scan cancelled before the discovery result was finalized.",
    );

  const byId = <T extends { id: string }>(a: T, b: T): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  sink.environments.sort(byId);
  sink.components.sort(byId);
  sink.relationships.sort(byId);
  sink.evidence.sort(byId);
  sink.coverage.sort((a, b) => {
    const first = `${a.collector}/${a.scope}/${a.status}`;
    const second = `${b.collector}/${b.scope}/${b.status}`;
    return first < second ? -1 : first > second ? 1 : 0;
  });
  sink.issues.sort((a, b) => {
    const first = `${a.collector}/${a.path ?? ""}/${a.code}`;
    const second = `${b.collector}/${b.path ?? ""}/${b.code}`;
    return first < second ? -1 : first > second ? 1 : 0;
  });

  return {
    projectId,
    sourceRevision,
    capturedAt,
    environments: sink.environments,
    components: sink.components,
    relationships: sink.relationships,
    evidence: sink.evidence,
    coverage: sink.coverage,
    issues: sink.issues,
    facts,
  };
}
