import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import * as formatsModule from "ajv-formats";
import configSchema from "./project-config.schema.json" with { type: "json" };
import type { DiscoveryEvidence } from "./types.js";
import { isSafeRelativePath } from "./safe-source.js";

export type DeclaredComponent = {
  key: string;
  kind:
    | "frontend"
    | "backend"
    | "package"
    | "runtime"
    | "test_suite"
    | "database"
    | "migration"
    | "pipeline"
    | "external_service"
    | "api_endpoint";
  layer: "frontend" | "backend" | "testing" | "data" | "delivery" | "shared" | "external";
  name: string;
  locator: string;
  environmentIds: string[];
  officialReferences: Array<{ title: string; url: string }>;
  internalPaths: string[];
};

export type DeclaredRelationship = {
  from: string;
  to: string;
  type: "depends_on" | "calls" | "reads_writes" | "deploys" | "tests" | "migrates";
  environmentIds: string[];
};

export type ProjectConfig = {
  version: 1;
  environments: Array<{ id: string; name: string }>;
  components: DeclaredComponent[];
  relationships: DeclaredRelationship[];
  migrationDirectories: string[];
  ignore: string[];
  collectors: string[];
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = formatsModule.default as unknown as FormatsPlugin;
addFormats(ajv);
const validateConfigSchema = ajv.compile<ProjectConfig>(configSchema);

export type ConfigParseResult =
  | { ok: true; value: ProjectConfig }
  | { ok: false; reason: "syntax" | "schema" | "unsafe_value" };

export function parseProjectConfig(source: Uint8Array): ConfigParseResult {
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
  } catch {
    return { ok: false, reason: "syntax" };
  }
  if (!validateConfigSchema(input)) return { ok: false, reason: "schema" };

  const value: ProjectConfig = {
    version: input.version,
    environments: input.environments ?? [],
    components: input.components ?? [],
    relationships: input.relationships ?? [],
    migrationDirectories: input.migrationDirectories ?? [],
    ignore: input.ignore ?? [],
    collectors: input.collectors ?? [],
  };
  const keys = new Set<string>();
  const environmentIds = new Set<string>();
  for (const environment of value.environments) {
    if (environmentIds.has(environment.id)) return { ok: false, reason: "unsafe_value" };
    environmentIds.add(environment.id);
  }
  for (const component of value.components) {
    if (
      keys.has(component.key) ||
      !isSafeRelativePath(component.locator) ||
      containsControlCharacter(component.key) ||
      containsControlCharacter(component.name) ||
      component.environmentIds.some(
        (environmentId) => !environmentIds.has(environmentId),
      )
    ) {
      return { ok: false, reason: "unsafe_value" };
    }
    keys.add(component.key);
    for (const reference of component.officialReferences) {
      try {
        const url = new URL(reference.url);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          !url.hostname ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          containsControlCharacter(reference.title)
        ) {
          return { ok: false, reason: "unsafe_value" };
        }
      } catch {
        return { ok: false, reason: "unsafe_value" };
      }
    }
  }

  for (const relationship of value.relationships) {
    if (
      !keys.has(relationship.from) ||
      !keys.has(relationship.to) ||
      relationship.environmentIds.some(
        (environmentId) => !environmentIds.has(environmentId),
      )
    ) {
      return { ok: false, reason: "unsafe_value" };
    }
  }
  for (const path of value.migrationDirectories) {
    if (!isSafeRelativePath(path)) return { ok: false, reason: "unsafe_value" };
  }
  for (const pattern of value.ignore) {
    if (
      !isSafeRelativePath(pattern.replaceAll("*", "x")) ||
      pattern.split("/").some((segment) => segment.toLowerCase().includes(".env"))
    ) {
      return { ok: false, reason: "unsafe_value" };
    }
  }
  return { ok: true, value };
}

function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function configEvidence(path: string, observedAt: string): DiscoveryEvidence {
  return {
    id: "",
    sourceType: "declaration",
    path,
    url: null,
    line: null,
    observedAt,
    description: "User-authored project declaration; not runtime verification.",
  };
}
