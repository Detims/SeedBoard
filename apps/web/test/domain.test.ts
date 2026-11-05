import { describe, expect, it } from "vitest";
import type { Snapshot } from "@modernizer/contracts";
import demoSnapshot from "../../../fixtures/demo.snapshot.json";
import {
  deterministicLayout,
  filterComponents,
  filterOverviewArchitectureComponents,
  getQualityCoverageSummary,
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

  it("keeps shared components out of the overview architecture preview", () => {
    const preview = filterOverviewArchitectureComponents(snapshot.components);
    expect(preview.every((component) => component.layer !== "shared")).toBe(true);
    expect(preview.map((component) => component.layer)).toEqual(
      expect.arrayContaining(["frontend", "backend", "data"]),
    );
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

  it("reports declaration mappings separately from runtime test and deployment status", () => {
    const summary = getQualityCoverageSummary(snapshot);
    expect(summary.testSuites.map(({ id }) => id)).toEqual(["cmp-tests"]);
    expect(summary.testMappedCount).toBe(1);
    expect(summary.testableComponentCount).toBe(5);
    expect(summary.measuredTestCoveragePercent).toBeNull();
    expect(summary.pipelines.map(({ id }) => id)).toEqual(["cmp-ci"]);
    expect(summary.deployMappedCount).toBe(1);
    expect(summary.deployableComponentCount).toBe(4);
  });

  it("flags high direct dependency counts and missing test mappings without inventing results", () => {
    const summary = getQualityCoverageSummary(snapshot);
    expect(summary.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: expect.objectContaining({ id: "cmp-api" }),
          dependencyCount: 4,
          hasTestMapping: true,
        }),
        expect.objectContaining({
          component: expect.objectContaining({ id: "cmp-worker" }),
          dependencyCount: 1,
          hasTestMapping: false,
        }),
      ]),
    );

    const repeatedEnvironmentEdge = structuredClone(snapshot);
    repeatedEnvironmentEdge.relationships.push({
      ...repeatedEnvironmentEdge.relationships.find(({ id }) => id === "rel-09")!,
      id: "rel-09-secondary-environment",
      environmentIds: ["env-test"],
    });
    expect(
      getQualityCoverageSummary(repeatedEnvironmentEdge).risks.find(
        ({ component }) => component.id === "cmp-api",
      )?.dependencyCount,
    ).toBe(4);

    const noMappings = structuredClone(snapshot);
    noMappings.relationships = noMappings.relationships.filter(
      ({ type }) => type !== "tests" && type !== "deploys",
    );
    const unknownSummary = getQualityCoverageSummary(noMappings);
    expect(unknownSummary.testMappedCount).toBe(0);
    expect(unknownSummary.deployMappedCount).toBe(0);
    expect(unknownSummary.risks.every(({ hasTestMapping }) => !hasTestMapping)).toBe(true);
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
