import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSnapshot, validateSnapshot } from "../src/index.js";
import type { Snapshot } from "../src/generated.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const demo = JSON.parse(
  await readFile(resolve(repoRoot, "fixtures/demo.snapshot.json"), "utf8"),
) as Snapshot;

function cloneSnapshot(): Snapshot {
  return structuredClone(demo);
}

describe("snapshot contract", () => {
  it("accepts the labeled synthetic demonstration", () => {
    expect(validateSnapshot(demo)).toEqual({ valid: true, issues: [] });
  });

  it("rejects duplicate component IDs", () => {
    const input = cloneSnapshot();
    input.components[1]!.id = input.components[0]!.id;
    const result = validateSnapshot(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.keyword === "uniqueIds")).toBe(true);
  });

  it("rejects dangling relationship endpoints", () => {
    const input = cloneSnapshot();
    input.relationships[0]!.toId = "component-missing";
    const result = validateSnapshot(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.keyword === "reference")).toBe(true);
  });

  it("requires exactly one documentation record for every component", () => {
    const input = cloneSnapshot();
    input.documentation = input.documentation.filter(
      (record) => record.componentId !== input.components[0]!.id,
    );
    const result = validateSnapshot(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.keyword === "documentationCoverage")).toBe(true);
  });

  it.each([
    "../outside",
    "C:/private/file",
    "/absolute/file",
    "safe\\..\\outside",
    "safe//empty-segment",
  ])("rejects unsafe paths: %s", (unsafePath) => {
    const input = cloneSnapshot();
    input.components[0]!.locator = unsafePath;
    const result = validateSnapshot(input);
    expect(result.valid).toBe(false);
  });

  it("requires an environment for deployed version claims", () => {
    const input = cloneSnapshot();
    input.components[0]!.versions.push({
      facet: "deployed",
      value: "3.1.4",
      environmentId: null,
      observedAt: input.capturedAt,
      evidenceIds: [input.components[0]!.evidenceIds[0]!],
    });
    const result = validateSnapshot(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.keyword === "deployedEnvironment")).toBe(true);
  });

  it("validates versioned rule evidence and safe relative documentation paths", () => {
    const input = cloneSnapshot();
    input.documentation[0]!.internalPaths = ["../private/runbook.md"];
    expect(validateSnapshot(input).valid).toBe(false);
    expect(() => assertSnapshot(input)).toThrow(/Invalid Modernizer snapshot/);
  });
});
