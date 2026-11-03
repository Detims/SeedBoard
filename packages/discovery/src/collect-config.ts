import type { ProjectConfig } from "./config.js";
import { parseProjectConfig } from "./config.js";
import {
  addComponent,
  addCoverage,
  addEvidence,
  addIssue,
  addRelationship,
  readUtf8,
  stableId,
  type CollectorSink,
} from "./shared.js";
import type { DiscoveryEnvironment } from "./types.js";
import type { SafeSource } from "./safe-source.js";

export type ConfigCollection = {
  config: ProjectConfig | null;
  keyToComponentId: Map<string, string>;
  environmentIds: Set<string>;
  documentationHints: Array<{
    componentId: string;
    officialReferences: Array<{ title: string; url: string }>;
    internalPaths: string[];
  }>;
  migrationDirectories: string[];
  ignorePatterns: string[];
};

const collectorPath = ".modernizer/project.json";

export async function collectProjectConfig(
  source: SafeSource,
  sink: CollectorSink,
  selectedCollectors: ReadonlySet<string> | null,
): Promise<ConfigCollection> {
  const keyToComponentId = new Map<string, string>();
  const environmentIds = new Set<string>();
  const documentationHints: ConfigCollection["documentationHints"] = [];
  const defaultResult: ConfigCollection = {
    config: null,
    keyToComponentId,
    environmentIds,
    documentationHints,
    migrationDirectories: [],
    ignorePatterns: [],
  };

  if (selectedCollectors && !selectedCollectors.has("project-config")) {
    addCoverage(
      sink,
      "project-config",
      "not_configured",
      collectorPath,
      "Disabled by project configuration.",
    );
    return defaultResult;
  }
  if (!source.has(collectorPath)) {
    addCoverage(
      sink,
      "project-config",
      "not_configured",
      collectorPath,
      "No optional project declaration was supplied.",
    );
    return defaultResult;
  }

  const text = await readUtf8(source, sink, "project-config", collectorPath);
  if (text === null) {
    return defaultResult;
  }

  const parsed = parseProjectConfig(new TextEncoder().encode(text));
  if (!parsed.ok) {
    addCoverage(
      sink,
      "project-config",
      "failed",
      collectorPath,
      "Project declaration is malformed or violates its schema.",
    );
    addIssue(
      sink,
      "project-config",
      parsed.reason === "syntax" ? "parse_failed" : "invalid_config",
      collectorPath,
      "Project declaration is malformed or unsafe.",
    );
    return defaultResult;
  }

  const config = parsed.value;
  const evidenceId = addEvidence(
    sink,
    "declaration",
    collectorPath,
    null,
    "User-authored project declaration; not runtime verification.",
  );
  const envs: DiscoveryEnvironment[] = config.environments.map(({ id, name }) => ({ id, name }));
  sink.environments.push(...envs);
  for (const environment of envs) environmentIds.add(environment.id);

  for (const declaration of config.components) {
    const id = stableId(
      "component",
      sink.projectId,
      declaration.kind,
      `declaration:${declaration.key}`,
      declaration.name,
    );
    keyToComponentId.set(declaration.key, id);
    const valid = addComponent(
      sink,
      {
        id,
        kind: declaration.kind,
        layer: declaration.layer,
        name: declaration.name,
        locator: declaration.locator,
        environmentIds: declaration.environmentIds,
        versions: [],
        observations: [
          {
            dimension: "configuration",
            state: "configured",
            environmentId: null,
            observedAt: sink.capturedAt,
            confidence: "medium",
            evidenceIds: [evidenceId],
          },
        ],
        evidenceIds: [evidenceId],
      },
      "project-config",
    );
    if (!valid) return { ...defaultResult, config: null };
    if (declaration.officialReferences.length > 0 || declaration.internalPaths.length > 0) {
      documentationHints.push({
        componentId: id,
        officialReferences: declaration.officialReferences,
        internalPaths: declaration.internalPaths,
      });
    }
  }

  for (const declaration of config.relationships) {
    const fromId = keyToComponentId.get(declaration.from);
    const toId = keyToComponentId.get(declaration.to);
    if (!fromId || !toId) continue; // parseProjectConfig rejects dangling keys.
    addRelationship(
      sink,
      {
        id: stableId("relationship", sink.projectId, fromId, toId, declaration.type),
        fromId,
        toId,
        type: declaration.type,
        environmentIds: declaration.environmentIds,
        confidence: "high",
        evidenceIds: [evidenceId],
      },
      "project-config",
    );
  }
  addCoverage(
    sink,
    "project-config",
    "supported",
    collectorPath,
    "Validated declarations supplied by the project owner; not runtime verification.",
  );
  return {
    config,
    keyToComponentId,
    environmentIds,
    documentationHints,
    migrationDirectories: config.migrationDirectories,
    ignorePatterns: config.ignore,
  };
}
