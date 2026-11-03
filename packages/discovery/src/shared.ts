import { createHash } from "node:crypto";
import type {
  CollectorCoverage,
  CollectorId,
  DiscoveryComponent,
  DiscoveryEnvironment,
  DiscoveryEvidence,
  DiscoveryIssue,
  DiscoveryRelationship,
  ScanBudgets,
} from "./types.js";

export type CollectorSink = {
  projectId: string;
  capturedAt: string;
  budgets: ScanBudgets;
  environments: DiscoveryEnvironment[];
  components: DiscoveryComponent[];
  relationships: DiscoveryRelationship[];
  evidence: DiscoveryEvidence[];
  coverage: CollectorCoverage[];
  issues: DiscoveryIssue[];
};

export function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
  return `${prefix}-${digest}`;
}

export function addEvidence(
  sink: CollectorSink,
  sourceType: DiscoveryEvidence["sourceType"],
  path: string | null,
  url: string | null,
  description: string,
  line: number | null = null,
): string {
  const id = stableId("evidence", sourceType, path ?? "", url ?? "");
  if (!sink.evidence.some((evidence) => evidence.id === id)) {
    sink.evidence.push({
      id,
      sourceType,
      path,
      url,
      line,
      observedAt: sink.capturedAt,
      description,
    });
  }
  return id;
}

export function addCoverage(
  sink: CollectorSink,
  collector: CollectorId,
  status: CollectorCoverage["status"],
  scope: string,
  reason: string,
): void {
  sink.coverage.push({ collector, status, scope, observedAt: sink.capturedAt, reason });
}

export function addIssue(
  sink: CollectorSink,
  collector: CollectorId,
  code: DiscoveryIssue["code"],
  path: string | null,
  message: string,
): void {
  sink.issues.push({ collector, code, path, message });
}

export function readFailureCode(error: unknown): DiscoveryIssue["code"] {
  if (!(error instanceof RangeError)) return "read_failed";
  if (error.message.includes("cumulative")) return "limit_bytes";
  return "limit_file_size";
}

export function readFailureMessage(code: DiscoveryIssue["code"]): string {
  if (code === "limit_bytes") return "Cumulative input size limit reached; remaining inputs were not read.";
  if (code === "limit_file_size") return "Input file exceeds the configured per-file size limit.";
  return "Input could not be read safely.";
}

export function addComponent(
  sink: CollectorSink,
  component: DiscoveryComponent,
  collector: CollectorId,
): boolean {
  if (sink.components.some((existing) => existing.id === component.id)) return true;
  if (sink.components.length >= sink.budgets.maxComponents) {
    addCoverage(
      sink,
      collector,
      "failed",
      "Component inventory",
      "The component limit was reached; remaining component records were not collected.",
    );
    addIssue(
      sink,
      collector,
      "limit_components",
      component.locator,
      "Component limit reached; scan output is incomplete.",
    );
    return false;
  }
  sink.components.push(component);
  return true;
}

export function addRelationship(
  sink: CollectorSink,
  relationship: DiscoveryRelationship,
  collector: CollectorId,
): boolean {
  if (sink.relationships.some((existing) => existing.id === relationship.id)) return true;
  if (sink.relationships.length >= sink.budgets.maxRelationships) {
    addCoverage(
      sink,
      collector,
      "failed",
      "Architecture relationships",
      "The relationship limit was reached; remaining relationships were not collected.",
    );
    addIssue(
      sink,
      collector,
      "limit_relationships",
      null,
      "Relationship limit reached; scan output is incomplete.",
    );
    return false;
  }
  sink.relationships.push(relationship);
  return true;
}
