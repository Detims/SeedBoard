import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSnapshot } from "@modernizer/contracts";
import { integratedScanRunner } from "../src/integratedScanner.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const syntheticRoot = resolve(repositoryRoot, "packages/discovery/fixtures/synthetic-target");

describe("integrated static scan", () => {
  it("composes discovery, documentation coverage, suggestions, and contract validation", async () => {
    const stages: string[] = [];
    const outcome = await integratedScanRunner(
      {
        id: "synthetic-project",
        name: "Synthetic target",
        rootPath: syntheticRoot,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        signal: new AbortController().signal,
        reportProgress: (progress) => stages.push(progress.stage),
      },
    );
    assertSnapshot(outcome.snapshot);
    expect(outcome.snapshot.demo).toBe(false);
    expect(outcome.snapshot.components.length).toBeGreaterThan(0);
    expect(outcome.snapshot.documentation).toHaveLength(outcome.snapshot.components.length);
    expect(new Set(outcome.snapshot.documentation.map((item) => item.componentId)).size).toBe(
      outcome.snapshot.components.length,
    );
    expect(stages).toEqual(["collecting", "documentation", "suggestions", "validating"]);
    expect(outcome.snapshot.components.map((item) => item.kind)).toContain("migration");
    expect(outcome.snapshot.components.some((item) => item.kind === "pipeline")).toBe(true);
    expect(
      outcome.snapshot.evidence.every(
        (item) => item.path === null || !/^[A-Za-z]:|^\//.test(item.path),
      ),
    ).toBe(true);
  });
});
