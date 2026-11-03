import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import * as formatsModule from "ajv-formats";
import type { Snapshot } from "./generated.js";
import { snapshotSchema } from "./schema.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = formatsModule.default as unknown as FormatsPlugin;
addFormats(ajv);
const validateSchema = ajv.compile<Snapshot>(snapshotSchema);

export type SnapshotIssue = {
  path: string;
  keyword: string;
  message: string;
};

export type SnapshotValidation = {
  valid: boolean;
  issues: SnapshotIssue[];
};

const observationStates: Record<string, ReadonlySet<string>> = {
  configuration: new Set(["configured", "not_configured", "unknown"]),
  health: new Set(["healthy", "degraded", "unhealthy", "unknown"]),
  ci: new Set(["passed", "failed", "pending", "unknown"]),
  migration: new Set(["applied", "pending", "failed", "unknown"]),
  support: new Set(["supported", "unsupported", "unknown"]),
};

function schemaIssues(errors: ErrorObject[] | null | undefined): SnapshotIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "does not match the snapshot schema",
  }));
}

function isSafeRelativePath(value: string): boolean {
  const parts = value.split("/");
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function duplicateIds(
  records: ReadonlyArray<{ id: string }>,
  collection: string,
  issues: SnapshotIssue[],
): void {
  const seen = new Set<string>();
  records.forEach((record, index) => {
    if (seen.has(record.id)) {
      issues.push({
        path: `/${collection}/${index}/id`,
        keyword: "uniqueIds",
        message: `duplicate ID "${record.id}" in ${collection}`,
      });
    }
    seen.add(record.id);
  });
}

function referenceIds(
  ids: ReadonlyArray<string>,
  known: ReadonlySet<string>,
  path: string,
  issues: SnapshotIssue[],
): void {
  ids.forEach((id, index) => {
    if (!known.has(id)) {
      issues.push({
        path: `${path}/${index}`,
        keyword: "reference",
        message: `references unknown ID "${id}"`,
      });
    }
  });
}

function semanticIssues(snapshot: Snapshot): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  duplicateIds(snapshot.environments, "environments", issues);
  duplicateIds(snapshot.evidence, "evidence", issues);
  duplicateIds(snapshot.components, "components", issues);
  duplicateIds(snapshot.relationships, "relationships", issues);
  duplicateIds(snapshot.suggestions, "suggestions", issues);

  const environmentIds = new Set(snapshot.environments.map(({ id }) => id));
  const evidenceIds = new Set(snapshot.evidence.map(({ id }) => id));
  const componentIds = new Set(snapshot.components.map(({ id }) => id));

  for (const evidence of snapshot.evidence) {
    if (evidence.path !== null && !isSafeRelativePath(evidence.path)) {
      issues.push({
        path: `/evidence/${evidence.id}/path`,
        keyword: "safePath",
        message: "must be a safe relative path",
      });
    }
  }

  snapshot.components.forEach((component, index) => {
    const base = `/components/${index}`;
    if (!isSafeRelativePath(component.locator)) {
      issues.push({
        path: `${base}/locator`,
        keyword: "safePath",
        message: "must be a safe relative path",
      });
    }
    referenceIds(component.environmentIds, environmentIds, `${base}/environmentIds`, issues);
    referenceIds(component.evidenceIds, evidenceIds, `${base}/evidenceIds`, issues);
    component.versions.forEach((version, versionIndex) => {
      const versionPath = `${base}/versions/${versionIndex}`;
      referenceIds(version.evidenceIds, evidenceIds, `${versionPath}/evidenceIds`, issues);
      if (version.environmentId !== null && !environmentIds.has(version.environmentId)) {
        issues.push({
          path: `${versionPath}/environmentId`,
          keyword: "reference",
          message: `references unknown environment "${version.environmentId}"`,
        });
      }
      if (version.facet === "deployed" && version.environmentId === null) {
        issues.push({
          path: `${versionPath}/environmentId`,
          keyword: "deployedEnvironment",
          message: "deployed versions require an environment",
        });
      }
    });
    component.observations.forEach((observation, observationIndex) => {
      const observationPath = `${base}/observations/${observationIndex}`;
      referenceIds(observation.evidenceIds, evidenceIds, `${observationPath}/evidenceIds`, issues);
      if (!observationStates[observation.dimension]?.has(observation.state)) {
        issues.push({
          path: `${observationPath}/state`,
          keyword: "observationState",
          message: `state "${observation.state}" is invalid for ${observation.dimension}`,
        });
      }
      if (observation.environmentId !== null && !environmentIds.has(observation.environmentId)) {
        issues.push({
          path: `${observationPath}/environmentId`,
          keyword: "reference",
          message: `references unknown environment "${observation.environmentId}"`,
        });
      }
    });
  });

  snapshot.relationships.forEach((relationship, index) => {
    const base = `/relationships/${index}`;
    referenceIds([relationship.fromId, relationship.toId], componentIds, base, issues);
    referenceIds(relationship.environmentIds, environmentIds, `${base}/environmentIds`, issues);
    referenceIds(relationship.evidenceIds, evidenceIds, `${base}/evidenceIds`, issues);
  });

  snapshot.suggestions.forEach((suggestion, index) => {
    const base = `/suggestions/${index}`;
    referenceIds(suggestion.targetIds, componentIds, `${base}/targetIds`, issues);
    referenceIds(suggestion.evidenceIds, evidenceIds, `${base}/evidenceIds`, issues);
  });

  const docsByComponent = new Map<string, number>();
  snapshot.documentation.forEach((documentation, index) => {
    const base = `/documentation/${index}`;
    if (!componentIds.has(documentation.componentId)) {
      issues.push({
        path: `${base}/componentId`,
        keyword: "reference",
        message: `references unknown component "${documentation.componentId}"`,
      });
    }
    docsByComponent.set(
      documentation.componentId,
      (docsByComponent.get(documentation.componentId) ?? 0) + 1,
    );
    documentation.internalPaths.forEach((internalPath, pathIndex) => {
      if (!isSafeRelativePath(internalPath)) {
        issues.push({
          path: `${base}/internalPaths/${pathIndex}`,
          keyword: "safePath",
          message: "must be a safe relative path",
        });
      }
    });
  });
  snapshot.components.forEach((component, index) => {
    const count = docsByComponent.get(component.id) ?? 0;
    if (count !== 1) {
      issues.push({
        path: `/components/${index}/id`,
        keyword: "documentationCoverage",
        message: `expected exactly one documentation record; found ${count}`,
      });
    }
  });

  return issues;
}

export function validateSnapshot(input: unknown): SnapshotValidation {
  if (!validateSchema(input)) {
    return { valid: false, issues: schemaIssues(validateSchema.errors) };
  }
  const issues = semanticIssues(input);
  return { valid: issues.length === 0, issues };
}

export function assertSnapshot(input: unknown): asserts input is Snapshot {
  const result = validateSnapshot(input);
  if (!result.valid) {
    const details = result.issues.map(({ path, message }) => `${path}: ${message}`).join("\n");
    throw new TypeError(`Invalid Modernizer snapshot:\n${details}`);
  }
}

export type {
  Component,
  Coverage,
  Documentation,
  Environment,
  Evidence,
  Observation,
  Relationship,
  Snapshot,
  Suggestion,
  Version,
} from "./generated.js";
