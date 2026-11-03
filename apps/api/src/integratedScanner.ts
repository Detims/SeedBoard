import { randomUUID } from "node:crypto";
import { assertSnapshot, type Snapshot } from "@modernizer/contracts";
import { scanProject } from "@modernizer/discovery";
import { evaluateSuggestions, type RuleDiscoveryFacts } from "@modernizer/rules";
import { resolveDocumentation } from "@modernizer/docs";
import type { ScanRunner } from "./scanQueue.js";

/** Compose bounded collection, docs coverage, deterministic rules and contract validation. */
export const integratedScanRunner: ScanRunner = async (project, context) => {
  context.reportProgress({ stage: "collecting", completed: 0, total: null });
  const result = await scanProject({
    rootPath: project.rootPath,
    projectId: project.id,
    signal: context.signal,
  });
  context.reportProgress({
    stage: "documentation",
    completed: result.components.length,
    total: result.components.length,
  });
  const references = new Map(
    result.facts.documentationHints.map((hint) => [hint.componentId, hint]),
  );
  const components = result.components.map((component) => ({
    ...component,
    environmentIds: [...new Set(component.environmentIds)],
    evidenceIds: [...new Set(component.evidenceIds)] as typeof component.evidenceIds,
    versions: component.versions.map((version) => ({
      ...version,
      evidenceIds: [...new Set(version.evidenceIds)] as typeof version.evidenceIds,
    })),
    observations: component.observations.map((observation) => ({
      ...observation,
      evidenceIds: [...new Set(observation.evidenceIds)] as typeof observation.evidenceIds,
    })),
  }));
  const relationships = result.relationships.map((relationship) => ({
    ...relationship,
    environmentIds: [...new Set(relationship.environmentIds)],
    evidenceIds: [...new Set(relationship.evidenceIds)] as typeof relationship.evidenceIds,
  }));
  const base: Snapshot = {
    schemaVersion: "1.0",
    id: randomUUID(),
    projectId: result.projectId,
    sourceRevision: result.sourceRevision,
    capturedAt: result.capturedAt,
    demo: false,
    environments: result.environments,
    evidence: result.evidence,
    components,
    relationships,
    coverage: result.coverage,
    suggestions: [],
    documentation: result.components.map((component) => {
      const hint = references.get(component.id);
      const officialReferences = (hint?.officialReferences ?? []).map((reference) => ({
        ...reference,
        verifiedAt: null,
      }));
      const internalPaths = hint?.internalPaths ?? [];
      const hasAnyReference = officialReferences.length > 0 || internalPaths.length > 0;
      return {
        componentId: component.id,
        status: hasAnyReference ? ("partial" as const) : ("undocumented" as const),
        officialReferences,
        internalPaths,
        reviewedAt: null,
        gap: hasAnyReference
          ? "Documentation hints are unverified; owner review and a current internal operations guide are still required."
          : "No documentation reference was collected; author and review an internal service guide.",
      };
    }),
  };
  base.documentation = resolveDocumentation(base);
  context.reportProgress({ stage: "suggestions", completed: 0, total: null });
  const ruleFacts: RuleDiscoveryFacts = {
    workflows: result.facts.workflows,
    dependencies: result.facts.dependencies,
    workspaces: result.facts.workspaces,
    coverage: result.facts.coverage,
  };
  base.suggestions = evaluateSuggestions(base, ruleFacts);
  context.reportProgress({ stage: "validating", completed: 1, total: 1 });
  assertSnapshot(base);
  return {
    snapshot: base,
    issues: result.issues.map((issue) => ({ code: issue.code, message: issue.message })),
  };
};
