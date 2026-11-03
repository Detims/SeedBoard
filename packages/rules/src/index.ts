import { createHash } from "node:crypto";
import type { Component, Relationship, Snapshot, Suggestion } from "@modernizer/contracts";
import type {
  DependencyOccurrenceFact,
  RuleDiscoveryFacts,
  WorkflowFact,
  WorkflowJobFact,
} from "./types.js";

export type {
  DependencyOccurrenceFact,
  RuleDiscoveryFacts,
  WorkflowFact,
  WorkflowJobFact,
  WorkspaceFact,
} from "./types.js";
import type { WorkspaceFact } from "./types.js";

type RuleCategory = Suggestion["category"];
type RuleDefinition = {
  id: string;
  version: number;
  category: RuleCategory;
  priority: Suggestion["priority"];
  effort: Suggestion["effort"];
  confidence: Suggestion["confidence"];
};

const ruleDefinitions = {
  feat: {
    id: "FEAT-001",
    version: 1,
    category: "feat",
    priority: "P2",
    effort: "medium",
    confidence: "medium",
  },
  chore: {
    id: "CHORE-001",
    version: 1,
    category: "chore",
    priority: "P3",
    effort: "medium",
    confidence: "high",
  },
  refactor: {
    id: "REFACTOR-001",
    version: 1,
    category: "refactor",
    priority: "P2",
    effort: "large",
    confidence: "high",
  },
  style: {
    id: "STYLE-001",
    version: 1,
    category: "style",
    priority: "P3",
    effort: "small",
    confidence: "medium",
  },
  fix: {
    id: "FIX-001",
    version: 1,
    category: "fix",
    priority: "P1",
    effort: "small",
    confidence: "high",
  },
  docs: {
    id: "DOCS-001",
    version: 1,
    category: "docs",
    priority: "P3",
    effort: "small",
    confidence: "high",
  },
} satisfies Record<string, RuleDefinition>;

const priorityRank: Record<Suggestion["priority"], number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const confidenceRank: Record<Suggestion["confidence"], number> = { high: 0, medium: 1, low: 2 };
const formatterScripts = new Set([
  "format",
  "format:check",
  "format:write",
  "fmt",
  "pretty",
  "prettier:check",
]);
const snapshotIndexes = new WeakMap<Snapshot, SnapshotIndex>();

type SnapshotIndex = {
  components: ReadonlyMap<string, Component>;
  evidence: ReadonlyMap<string, Snapshot["evidence"][number]>;
};

function indexOf(snapshot: Snapshot): SnapshotIndex {
  const existing = snapshotIndexes.get(snapshot);
  if (existing) return existing;
  const index = {
    components: new Map(snapshot.components.map((component) => [component.id, component])),
    evidence: new Map(snapshot.evidence.map((record) => [record.id, record])),
  } satisfies SnapshotIndex;
  snapshotIndexes.set(snapshot, index);
  return index;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareLexical);
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeText(value: string, maxLength: number): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function buildFingerprint(
  projectId: string,
  rule: RuleDefinition,
  targetIds: readonly string[],
  conditionKey: string,
): string {
  const stableInput = JSON.stringify([
    projectId,
    rule.id,
    rule.version,
    uniqueSorted(targetIds),
    conditionKey,
  ]);
  const digest = createHash("sha256").update(stableInput).digest("hex");
  return `mrz1:${digest}`;
}

function makeSuggestion(
  snapshot: Snapshot,
  rule: RuleDefinition,
  targetIds: readonly string[],
  evidenceIds: readonly string[],
  conditionKey: string,
  title: string,
  rationale: string,
  action: string,
  verification: readonly string[],
): Suggestion | undefined {
  const index = indexOf(snapshot);
  const targets = uniqueSorted(targetIds);
  const evidence = uniqueSorted(evidenceIds);

  if (
    targets.length === 0 ||
    targets.some((id) => !index.components.has(id)) ||
    evidence.length === 0 ||
    evidence.some((id) => !index.evidence.has(id))
  ) {
    return undefined;
  }

  const fingerprint = buildFingerprint(snapshot.projectId, rule, targets, conditionKey);
  return {
    id: `sg-${rule.id}-${fingerprint.slice(-16)}`,
    fingerprint,
    ruleId: rule.id,
    ruleVersion: rule.version,
    category: rule.category,
    targetIds: [targets[0]!, ...targets.slice(1)],
    priority: rule.priority,
    effort: rule.effort,
    confidence: rule.confidence,
    evidenceIds: [evidence[0]!, ...evidence.slice(1)],
    title: safeText(title, 240),
    rationale: safeText(rationale, 3000),
    action: safeText(action, 1800),
    verification: [
      safeText(verification[0] ?? "Review the cited evidence.", 800),
      ...verification.slice(1, 12).map((step) => safeText(step, 800)),
    ],
  };
}

function evidenceDescription(snapshot: Snapshot, ids: readonly string[]): string[] {
  const evidenceById = indexOf(snapshot).evidence;
  return uniqueSorted(ids).flatMap((id) => {
    const record = evidenceById.get(id);
    if (!record) return [];
    return [record.path ? `${record.description} (${record.path})` : record.description];
  });
}

function isSupportedComponent(snapshot: Snapshot, id: string, kind?: Component["kind"]): boolean {
  const component = indexOf(snapshot).components.get(id);
  return Boolean(component && (!kind || component.kind === kind));
}

function hasEvidence(snapshot: Snapshot, ...ids: string[]): boolean {
  const evidence = indexOf(snapshot).evidence;
  return ids.length > 0 && ids.every((id) => evidence.has(id));
}

function evaluateFixRule(snapshot: Snapshot, workflows: readonly WorkflowFact[]): Suggestion[] {
  const findings: Suggestion[] = [];
  const rule = ruleDefinitions.fix;

  for (const workflow of workflows) {
    if (
      workflow.parseStatus !== "complete" ||
      workflow.hasDynamicNeeds ||
      !isSupportedComponent(snapshot, workflow.pipelineComponentId, "pipeline") ||
      !hasEvidence(snapshot, workflow.workflowEvidenceId)
    ) {
      continue;
    }

    const jobIds = new Set(workflow.jobs.map((job) => job.id));
    for (const job of workflow.jobs) {
      const missingJobIds = uniqueSorted(
        (job.missingNeeds ?? job.needs.filter((neededId) => !jobIds.has(neededId))).filter(
          (neededId) => !jobIds.has(neededId),
        ),
      );
      if (missingJobIds.length === 0 || !hasEvidence(snapshot, job.sourceEvidenceId)) continue;

      for (const missingJobId of missingJobIds) {
        const evidence = [workflow.workflowEvidenceId, job.sourceEvidenceId];
        if (!hasEvidence(snapshot, ...evidence)) continue;
        const supportingDetails = evidenceDescription(snapshot, evidence).join("; ");
        const finding = makeSuggestion(
          snapshot,
          rule,
          [workflow.pipelineComponentId],
          evidence,
          `${workflow.path}|${job.id}|${missingJobId}`,
          `fix: repair missing workflow prerequisite ${missingJobId}`,
          `Job “${job.name}” declares a literal prerequisite “${missingJobId}” that is absent from the successfully parsed workflow. Evidence: ${supportingDetails}.`,
          `Review the workflow and either restore the intended job or correct the prerequisite reference.`,
          [
            "Confirm the corrected needs value resolves to an existing job.",
            "Parse the workflow again and verify that no missing literal prerequisite remains.",
          ],
        );
        if (finding) findings.push(finding);
      }
    }
  }
  return findings;
}

function ancestorJobs(
  job: WorkflowJobFact,
  jobsById: ReadonlyMap<string, WorkflowJobFact>,
): Set<string> | undefined {
  const ancestors = new Set<string>();
  const visited = new Set<string>();
  const pending = [...job.needs];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const dependency = jobsById.get(id);
    if (!dependency) return undefined;
    ancestors.add(id);
    pending.push(...dependency.needs);
  }
  return ancestors;
}

function evaluateFeatureRule(snapshot: Snapshot, workflows: readonly WorkflowFact[]): Suggestion[] {
  const findings: Suggestion[] = [];
  const rule = ruleDefinitions.feat;

  for (const workflow of workflows) {
    if (
      workflow.parseStatus !== "complete" ||
      workflow.hasDynamicNeeds ||
      !workflow.jobs.some((job) => job.deploysTarget) ||
      !isSupportedComponent(snapshot, workflow.pipelineComponentId, "pipeline") ||
      !hasEvidence(snapshot, workflow.workflowEvidenceId)
    ) {
      continue;
    }

    const jobsById = new Map(workflow.jobs.map((job) => [job.id, job]));
    const deployJobs = workflow.jobs.filter((job) => job.deploysTarget);
    for (const deployJob of deployJobs) {
      const ancestors = ancestorJobs(deployJob, jobsById);
      // A dangling literal or unresolved dependency makes this pipeline path unknown.
      if (!ancestors) continue;
      const testGateOnPath = [...ancestors].some((id) => jobsById.get(id)?.isTestGate);
      if (testGateOnPath || !hasEvidence(snapshot, deployJob.sourceEvidenceId)) continue;

      const pathEvidence = [workflow.workflowEvidenceId, deployJob.sourceEvidenceId];
      const gateCandidateSources = [...ancestors]
        .map((id) => jobsById.get(id))
        .filter((job): job is WorkflowJobFact => Boolean(job && !job.isTestGate))
        .map((job) => job.sourceEvidenceId);
      pathEvidence.push(...gateCandidateSources);
      const evidence = uniqueSorted(pathEvidence);
      if (!hasEvidence(snapshot, ...evidence)) continue;

      const finding = makeSuggestion(
        snapshot,
        rule,
        [workflow.pipelineComponentId],
        evidence,
        `${workflow.path}|deploy:${deployJob.id}|test-gate:none-on-needs-path`,
        "feat: add a verified test gate before deployment",
        `Deployment job “${deployJob.name}” has no declared test-gate job in its literal needs dependency path. This describes workflow configuration only; no workflow run was checked.`,
        "Review the deployment dependency path and add the intended test job as a prerequisite if this project requires CI tests before deployment.",
        [
          "Confirm the intended test command and environment.",
          "Verify the test job appears in the deployment job’s needs ancestry.",
          "Verify a failing test prevents the deployment job from running.",
        ],
      );
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

function evaluateChoreRule(
  snapshot: Snapshot,
  packageFacts: readonly DependencyOccurrenceFact[],
): Suggestion[] {
  const groups = new Map<string, DependencyOccurrenceFact[]>();
  for (const occurrence of packageFacts) {
    if (
      !occurrence.name.trim() ||
      !occurrence.version.trim() ||
      occurrence.lockEvidenceId === null ||
      !isSupportedComponent(snapshot, occurrence.componentId, "package") ||
      !hasEvidence(snapshot, occurrence.manifestEvidenceId, occurrence.lockEvidenceId)
    ) {
      continue;
    }
    const key = `${occurrence.workspacePath.replaceAll("\\", "/")}|${occurrence.name.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push(occurrence);
    groups.set(key, group);
  }

  const findings: Suggestion[] = [];
  const rule = ruleDefinitions.chore;
  for (const [groupKey, occurrences] of groups) {
    const versions = uniqueSorted(occurrences.map((occurrence) => occurrence.version));
    const targetIds = uniqueSorted(occurrences.map((occurrence) => occurrence.componentId));
    if (versions.length < 2 || targetIds.length < 2) continue;
    const evidence = uniqueSorted(
      occurrences.flatMap((occurrence) =>
        occurrence.lockEvidenceId
          ? [occurrence.manifestEvidenceId, occurrence.lockEvidenceId]
          : [occurrence.manifestEvidenceId],
      ),
    );
    if (!hasEvidence(snapshot, ...evidence)) continue;

    const packageName = occurrences[0]!.name;
    const supportingDetails = evidenceDescription(snapshot, evidence).join("; ");
    const finding = makeSuggestion(
      snapshot,
      rule,
      targetIds,
      evidence,
      `${groupKey}|versions:${versions.join(",")}`,
      `chore: evaluate ${packageName} version alignment`,
      `The same package resolves to ${versions.join(" and ")} within workspace “${occurrences[0]!.workspacePath}”. Review its consumers and compatibility before aligning versions. Evidence: ${supportingDetails}.`,
      "Check why both versions are needed, confirm their API and runtime compatibility, then decide whether alignment is safe.",
      [
        "Confirm each occurrence maps to the expected workspace and dependency path.",
        "Check package compatibility before changing declarations.",
        "Regenerate the lockfile and verify the intended resolved versions.",
      ],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

type DirectedEdge = { from: string; to: string; relationship: Relationship };

function stronglyConnectedComponents(
  nodeIds: readonly string[],
  edges: readonly DirectedEdge[],
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];

  const visit = (nodeId: string): void => {
    const nodeIndex = nextIndex++;
    indices.set(nodeId, nodeIndex);
    lowLinks.set(nodeId, nodeIndex);
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of adjacency.get(nodeId) ?? []) {
      if (!indices.has(targetId)) {
        visit(targetId);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(targetId)!));
      } else if (onStack.has(targetId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(targetId)!));
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      group.push(member);
    } while (member !== nodeId);
    result.push(group.sort(compareLexical));
  };

  for (const nodeId of [...nodeIds].sort(compareLexical)) {
    if (!indices.has(nodeId)) visit(nodeId);
  }
  return result;
}

function evaluateRefactorRule(snapshot: Snapshot): Suggestion[] {
  const eligibleComponents = snapshot.components.filter(
    (component) => component.kind !== "package",
  );
  const componentIds = new Set(eligibleComponents.map((component) => component.id));
  const edges = snapshot.relationships
    .filter((relationship) => relationship.type === "depends_on")
    .filter(
      (relationship) =>
        componentIds.has(relationship.fromId) && componentIds.has(relationship.toId),
    )
    .map((relationship) => ({
      from: relationship.fromId,
      to: relationship.toId,
      relationship,
    }));

  const findings: Suggestion[] = [];
  const rule = ruleDefinitions.refactor;
  for (const cycle of stronglyConnectedComponents([...componentIds], edges)) {
    if (cycle.length < 2) continue;
    const members = new Set(cycle);
    const cycleEdges = edges.filter((edge) => members.has(edge.from) && members.has(edge.to));
    const evidence = uniqueSorted(cycleEdges.flatMap((edge) => edge.relationship.evidenceIds));
    if (cycleEdges.length === 0 || !hasEvidence(snapshot, ...evidence)) continue;

    const componentNames = new Map(
      snapshot.components.map((component) => [component.id, component.name]),
    );
    const names = cycle.map((id) => componentNames.get(id) ?? id);
    const conditionEdges = cycleEdges
      .map((edge) => `${edge.from}->${edge.to}`)
      .sort(compareLexical);
    const finding = makeSuggestion(
      snapshot,
      rule,
      cycle,
      evidence,
      `cycle:${conditionEdges.join(",")}`,
      `refactor: inspect cyclic coupling among ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`,
      `The explicit component dependency graph contains a strongly connected group of ${cycle.length} non-package components: ${names.join(" → ")}. This indicates coupling for an owner to review, not a proven defect.`,
      "Review the cited dependency edges with component owners and decide whether a stable boundary can break the cycle.",
      [
        "Confirm that each dependency edge reflects current architecture.",
        "Identify ownership and contracts for each component in the cycle.",
        "If a boundary change is approved, verify the cycle is removed without breaking consumers.",
      ],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

function evaluateStyleRule(snapshot: Snapshot, workspaces: readonly WorkspaceFact[]): Suggestion[] {
  const findings: Suggestion[] = [];
  const rule = ruleDefinitions.style;
  for (const workspace of workspaces) {
    const component = snapshot.components.find((record) => record.id === workspace.componentId);
    if (
      !component ||
      !["frontend", "backend"].includes(component.kind) ||
      !hasEvidence(snapshot, workspace.manifestEvidenceId)
    ) {
      continue;
    }
    const hasFormattingScript = workspace.scripts.some((script) =>
      formatterScripts.has(script.toLowerCase()),
    );
    if (
      hasFormattingScript ||
      workspace.formatterConfigPresent ||
      workspace.formatterDependencyPresent
    ) {
      continue;
    }

    const finding = makeSuggestion(
      snapshot,
      rule,
      [component.id],
      [workspace.manifestEvidenceId],
      `${workspace.path.replaceAll("\\", "/")}|complete-manifest:no-format-script-or-config`,
      `style: establish a formatting convention for ${component.name}`,
      `The scanned application workspace manifest declares no formatting script, known formatter configuration, or formatter dependency. This does not prove that source formatting is incorrect; check any organization-wide convention first.`,
      "Confirm whether this project follows a repository or organization formatting standard before adding a formatter.",
      [
        "Check repository and organization guidance for existing formatting rules.",
        "If no convention exists, agree on a formatter and document how to run it.",
        "Verify the formatting command is deterministic and suitable for the workspace.",
      ],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

function evaluateDocsRule(snapshot: Snapshot): Suggestion[] {
  const docsByComponent = new Map(
    snapshot.documentation.map((record) => [record.componentId, record]),
  );
  const findings: Suggestion[] = [];
  const rule = ruleDefinitions.docs;

  for (const component of snapshot.components) {
    const documentation = docsByComponent.get(component.id);
    if (
      !documentation ||
      documentation.status === "complete" ||
      !hasEvidence(snapshot, ...component.evidenceIds)
    ) {
      continue;
    }
    const statusText = documentation.status === "partial" ? "partially documented" : "undocumented";
    const gap = documentation.gap?.trim();
    const finding = makeSuggestion(
      snapshot,
      rule,
      [component.id],
      component.evidenceIds,
      `${component.id}|documentation:${documentation.status}|${gap ?? "no-gap-text"}`,
      `docs: complete ${component.name} documentation`,
      `This component is ${statusText}${gap ? `: ${gap}` : "."}`,
      "Add or review the component’s official reference and a safe internal usage/runbook page. Mark unknown setup or operational details for owner verification.",
      [
        "Verify the official documentation link against the observed component version, if available.",
        "Document purpose, configuration names, consumers, and known operational behavior using evidence.",
        "Ask the component owner to review any remaining unknowns.",
      ],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

/** Evaluate all documented MVP rules without reading files, consulting the network, or applying changes. */
export function evaluateSuggestions(
  snapshot: Snapshot,
  facts: RuleDiscoveryFacts = {},
): Suggestion[] {
  snapshotIndexes.set(snapshot, {
    components: new Map(snapshot.components.map((component) => [component.id, component])),
    evidence: new Map(snapshot.evidence.map((record) => [record.id, record])),
  });
  try {
    const candidates = [
      ...evaluateFixRule(snapshot, facts.workflows ?? []),
      ...evaluateFeatureRule(snapshot, facts.workflows ?? []),
      ...(facts.coverage?.dependencyResolutionComplete
        ? evaluateChoreRule(snapshot, facts.dependencies ?? [])
        : []),
      ...evaluateRefactorRule(snapshot),
      ...(facts.coverage?.workspaceManifestsComplete
        ? evaluateStyleRule(snapshot, facts.workspaces ?? [])
        : []),
      ...evaluateDocsRule(snapshot),
    ];
    const unique = new Map<string, Suggestion>();
    for (const suggestion of candidates) {
      if (!unique.has(suggestion.fingerprint)) unique.set(suggestion.fingerprint, suggestion);
    }
    const suggestions = [...unique.values()];

    return suggestions.sort((left, right) => {
      return (
        priorityRank[left.priority] - priorityRank[right.priority] ||
        confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
        compareLexical(left.fingerprint, right.fingerprint)
      );
    });
  } finally {
    snapshotIndexes.delete(snapshot);
  }
}
