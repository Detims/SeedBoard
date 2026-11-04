import { describe, expect, it } from "vitest";
import type { Snapshot } from "@modernizer/contracts";
import demoSnapshot from "../../../fixtures/demo.snapshot.json";
import {
  deterministicLayout,
  filterComponents,
  getInventoryCounts,
  visibleRelationships,
} from "../src/domain.js";
import { filterDocumentationComponents, filterSuggestionsByCategory } from "../src/viewFilters.js";
import type { Documentation, Suggestion } from "@modernizer/contracts";

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

describe("documentation and suggestion filters", () => {
  it("searches documentation across components, versions, references, paths, status, and gaps", () => {
    const component = snapshot.components.find(({ id }) => id === "cmp-api")!;
    const records = [
      {
        componentId: component.id,
        status: "partial",
        officialReferences: [
          { title: "Fastify Guide", url: "https://fastify.dev/docs", verifiedAt: null },
        ],
        internalPaths: ["docs/api-operations.md"],
        reviewedAt: null,
        gap: "Authentication setup needs review",
      },
    ] satisfies Documentation[];

    expect(filterDocumentationComponents([component], records, "FASTIFY")).toEqual([component]);
    expect(filterDocumentationComponents([component], records, "API-OPERATIONS")).toEqual([
      component,
    ]);
    expect(filterDocumentationComponents([component], records, "needs review")).toEqual([
      component,
    ]);
    expect(filterDocumentationComponents([component], records, "no such reference")).toEqual([]);
    expect(filterDocumentationComponents([component], records, "  ")).toEqual([component]);
  });

  it("filters all six suggestion categories and can restore the complete list", () => {
    const base = snapshot.suggestions[0]!;
    const suggestions = ["feat", "chore", "refactor", "style", "fix", "docs"].map(
      (category, index) => ({ ...base, id: `suggestion-${index}`, category }),
    ) satisfies Suggestion[];

    for (const category of ["feat", "chore", "refactor", "style", "fix", "docs"] as const) {
      expect(
        filterSuggestionsByCategory(suggestions, category).map((item) => item.category),
      ).toEqual([category]);
    }
    expect(filterSuggestionsByCategory(suggestions, "all")).toHaveLength(6);
    expect(filterSuggestionsByCategory([], "fix")).toEqual([]);
  });
});
