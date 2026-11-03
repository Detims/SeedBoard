import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    parameters: Record<string, { in?: string; name?: string }>;
  };
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const specText = await readFile(resolve(repoRoot, "contracts/openapi.yaml"), "utf8");
const schemaText = await readFile(resolve(repoRoot, "contracts/snapshot.schema.json"), "utf8");

describe("OpenAPI contract", () => {
  it("parses as OpenAPI 3.1 and includes every documented operation", () => {
    const document = parseDocument(specText, { uniqueKeys: true }).toJS() as OpenApiDocument;
    const expected = [
      "GET /projects",
      "POST /projects/{projectId}/scans",
      "GET /scans/{scanId}",
      "POST /scans/{scanId}/cancel",
      "GET /projects/{projectId}/snapshots",
      "GET /snapshots/{snapshotId}",
      "GET /snapshots/{snapshotId}/diff",
      "GET /projects/{projectId}/layouts/{name}",
      "PUT /projects/{projectId}/layouts/{name}",
      "PUT /projects/{projectId}/suggestion-decisions/{fingerprint}",
      "GET /snapshots/{snapshotId}/export",
      "GET /healthz",
    ];

    expect(document.openapi).toBe("3.1.0");
    const operations = new Set(
      Object.entries(document.paths).flatMap(([path, item]) =>
        Object.entries(item)
          .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
          .map(([method]) => `${method.toUpperCase()} ${path}`),
      ),
    );
    expect(expected.filter((operation) => !operations.has(operation))).toEqual([]);
    expect(document.components.schemas).toHaveProperty("ErrorResponse");
    expect(document.components.schemas).toHaveProperty("DiffResponse");
    expect(document.components.schemas).toHaveProperty("LayoutInput");
    expect(document.components.schemas).toHaveProperty("SuggestionDecisionInput");
    expect(JSON.parse(schemaText).$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("defines every path parameter declared in a route template", () => {
    const document = parseDocument(specText, { uniqueKeys: true }).toJS() as OpenApiDocument;
    const failures: string[] = [];
    for (const [path, rawItem] of Object.entries(document.paths)) {
      const item = rawItem as Record<string, unknown>;
      const shared = (item.parameters ?? []) as Array<{
        in?: string;
        name?: string;
        $ref?: string;
      }>;
      for (const [method, rawOperation] of Object.entries(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const operation = rawOperation as { parameters?: unknown[] };
        const parameters = [
          ...shared,
          ...((operation.parameters ?? []) as Array<{
            in?: string;
            name?: string;
            $ref?: string;
          }>),
        ].map((parameter) => {
          if (!parameter.$ref?.startsWith("#/components/parameters/")) return parameter;
          const name = parameter.$ref.slice("#/components/parameters/".length);
          return document.components.parameters[name] ?? parameter;
        });
        for (const [, name] of path.matchAll(/\{([^}]+)}/g)) {
          if (!parameters.some((parameter) => parameter.in === "path" && parameter.name === name)) {
            failures.push(`${method.toUpperCase()} ${path} misses path parameter ${name}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
