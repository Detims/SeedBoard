import { describe, expect, it } from "vitest";
import type { Snapshot } from "@modernizer/contracts";
import demoSnapshot from "../../../fixtures/demo.snapshot.json";
import {
  deterministicLayout,
  filterComponents,
  getInventoryCounts,
  visibleRelationships,
} from "../src/domain.js";

const snapshot = demoSnapshot as Snapshot;

describe("dashboard inventory behavior", () => {
  it("counts unique architectural components separately from relationships", () => {
    const input = structuredClone(snapshot);
    input.components.push({ ...input.components[0]! });
    const counts = getInventoryCounts(input, input.components.length);
    expect(counts.total).toBe(snapshot.components.length);
    expect(counts.relationships).toBe(snapshot.relationships.length);
    expect(counts.undocumented + counts.partialDocumentation + counts.documented).toBe(
      snapshot.components.length,
    );
  });

  it("filters case-insensitively by label, kind, locator, or layer without changing the source", () => {
    expect(filterComponents(snapshot.components, "DEMO WEB", "all").map(({ id }) => id)).toEqual([
      "cmp-web",
    ]);
    expect(filterComponents(snapshot.components, "test suite", "all").map(({ id }) => id)).toEqual([
      "cmp-tests",
    ]);
    expect(filterComponents(snapshot.components, "database", "data").map(({ id }) => id)).toEqual([
      "cmp-db",
      "cmp-migration",
    ]);
    expect(snapshot.components).toHaveLength(11);
  });

  it("produces stable deterministic positions for the same snapshot", () => {
    const first = deterministicLayout(snapshot.components);
    const second = deterministicLayout(snapshot.components);
    expect(second).toEqual(first);
    expect(Object.keys(first)).toHaveLength(snapshot.components.length);
  });

  it("does not display relationships whose endpoint is filtered out", () => {
    const onlyWeb = new Set(["cmp-web"]);
    expect(visibleRelationships(snapshot.relationships, onlyWeb)).toEqual([]);
  });
});
