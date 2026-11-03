import type { Snapshot } from "@modernizer/contracts";

export type DiscoveryComponent = Snapshot["components"][number];
export type DiscoveryRelationship = Snapshot["relationships"][number];
export type DiscoveryEvidence = Snapshot["evidence"][number];
export type DiscoveryEnvironment = Snapshot["environments"][number];
export type CollectorCoverage = Snapshot["coverage"][number];

export type CollectorId =
  | "safe-walk"
  | "project-config"
  | "node-manifests"
  | "npm-lock"
  | "github-actions"
  | "migration-files";

export type DiscoveryIssue = {
  collector: CollectorId;
  code:
    | "scan_cancelled"
    | "root_invalid"
    | "limit_files"
    | "limit_bytes"
    | "limit_depth"
    | "limit_file_size"
    | "limit_components"
    | "limit_relationships"
    | "read_failed"
    | "parse_failed"
    | "unsupported_input"
    | "invalid_config";
  path: string | null;
  message: string;
};

export type WorkspaceFact = {
  path: string;
  componentId: string;
  manifestEvidenceId: string;
  scripts: string[];
  formatterConfigPresent: boolean;
  formatterDependencyPresent: boolean;
};

export type DependencyOccurrenceFact = {
  name: string;
  version: string;
  declaredRange: string | null;
  resolved: boolean;
  workspacePath: string;
  componentId: string;
  manifestEvidenceId: string;
  lockEvidenceId: string | null;
  direct: boolean;
};

export type WorkflowJobFact = {
  componentId: string;
  id: string;
  name: string;
  needs: string[];
  missingNeeds: string[];
  sourceEvidenceId: string;
  runScripts: string[];
  deploysTarget: boolean;
  isTestGate: boolean;
};

export type WorkflowFact = {
  path: string;
  pipelineComponentId: string;
  workflowEvidenceId: string;
  parseStatus: "complete" | "partial" | "failed";
  hasDynamicNeeds: boolean;
  jobs: WorkflowJobFact[];
  hasLiteralTestGate: boolean;
  ambiguityReasons: string[];
};

/** Sidecar rule facts are never serialized into snapshot schema 1.0. */
export type DiscoveryFacts = {
  workspaces: WorkspaceFact[];
  dependencies: DependencyOccurrenceFact[];
  workflows: WorkflowFact[];
  coverage: {
    workspaceManifestsComplete: boolean;
    dependencyResolutionComplete: boolean;
    workflowsComplete: boolean;
  };
  documentationHints: Array<{
    componentId: string;
    officialReferences: Array<{ title: string; url: string }>;
    internalPaths: string[];
  }>;
};

export type DiscoveryResult = {
  projectId: string;
  sourceRevision: string | null;
  capturedAt: string;
  environments: DiscoveryEnvironment[];
  components: DiscoveryComponent[];
  relationships: DiscoveryRelationship[];
  evidence: DiscoveryEvidence[];
  coverage: CollectorCoverage[];
  issues: DiscoveryIssue[];
  facts: DiscoveryFacts;
};

export type ScanBudgets = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  maxComponents: number;
  maxRelationships: number;
};

export const DEFAULT_SCAN_BUDGETS: Readonly<ScanBudgets> = {
  maxFiles: 20_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxDepth: 20,
  maxComponents: 2_000,
  maxRelationships: 5_000,
};

export type DirEntryLike = {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

export type FileStatLike = {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

/** Narrow injectable filesystem boundary used by tests and the local CLI. */
export type DiscoveryFileSystem = {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<FileStatLike>;
  lstat(path: string): Promise<FileStatLike>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntryLike[]>;
  readFile(path: string): Promise<Uint8Array>;
};

export type ScanProjectOptions = {
  rootPath: string;
  projectId: string;
  sourceRevision?: string | null;
  clock?: () => Date;
  signal?: AbortSignal;
  budgets?: Partial<ScanBudgets>;
  fileSystem?: DiscoveryFileSystem;
};
