export type WorkflowJobFact = {
  id: string;
  name: string;
  needs: string[];
  missingNeeds?: string[];
  sourceEvidenceId: string;
  deploysTarget: boolean;
  isTestGate: boolean;
};

export type WorkflowFact = {
  path: string;
  pipelineComponentId: string;
  workflowEvidenceId: string;
  parseStatus: "complete" | "partial" | "failed";
  jobs: WorkflowJobFact[];
  hasDynamicNeeds: boolean;
  hasLiteralTestGate: boolean;
  ambiguityReasons: string[];
};

export type DependencyOccurrenceFact = {
  componentId: string;
  name: string;
  version: string;
  workspacePath: string;
  manifestEvidenceId: string;
  lockEvidenceId: string | null;
};

export type WorkspaceFact = {
  componentId: string;
  path: string;
  manifestEvidenceId: string;
  scripts: string[];
  formatterConfigPresent: boolean;
  formatterDependencyPresent: boolean;
};

/**
 * Sidecar facts are produced by bounded collectors and stay outside snapshot interchange.
 * Every evidence/component ID must resolve against the accompanying snapshot.
 */
export type RuleDiscoveryFacts = {
  workflows?: WorkflowFact[];
  dependencies?: DependencyOccurrenceFact[];
  workspaces?: WorkspaceFact[];
  coverage?: {
    workspaceManifestsComplete?: boolean;
    dependencyResolutionComplete?: boolean;
    workflowsComplete?: boolean;
  };
};
