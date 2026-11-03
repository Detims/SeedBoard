import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSnapshot, type Snapshot } from "@modernizer/contracts";
import { evaluateSuggestions } from "../src/index.js";
import type { RuleDiscoveryFacts, WorkflowFact } from "../src/types.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const demo = JSON.parse(
  await readFile(resolve(repositoryRoot, "fixtures/demo.snapshot.json"), "utf8"),
) as Snapshot;

function snapshotCopy(): Snapshot {
  return structuredClone(demo);
}

function workflowFact(overrides: Partial<WorkflowFact> = {}): WorkflowFact {
  const fact: WorkflowFact = {
    path: ".github/workflows/ci.yml",
    pipelineComponentId: "cmp-ci",
    workflowEvidenceId: "ev-workflow",
    parseStatus: "complete",
    jobs: [
      {
        id: "build",
        name: "Build",
        needs: [],
        sourceEvidenceId: "ev-workflow",
        deploysTarget: false,
        isTestGate: false,
      },
      {
        id: "test",
        name: "Test",
        needs: ["build"],
        sourceEvidenceId: "ev-workflow",
        deploysTarget: false,
        isTestGate: true,
      },
      {
        id: "deploy",
        name: "Deploy",
        needs: ["build"],
        sourceEvidenceId: "ev-workflow",
        deploysTarget: true,
        isTestGate: false,
      },
    ],
    hasDynamicNeeds: false,
    ambiguityReasons: [],
    ...overrides,
    hasLiteralTestGate: overrides.hasLiteralTestGate ?? true,
  };
  const jobIds = new Set(fact.jobs.map((job) => job.id));
  fact.jobs = fact.jobs.map((job) => ({
    ...job,
    missingNeeds: job.needs.filter((neededId) => !jobIds.has(neededId)),
  }));
  return fact;
}

function facts(workflow?: WorkflowFact): RuleDiscoveryFacts {
  return {
    workflows: workflow ? [workflow] : [],
    dependencies: [],
    workspaces: [],
  };
}

function category(ruleResults: ReturnType<typeof evaluateSuggestions>, ruleId: string) {
  return ruleResults.filter((suggestion) => suggestion.ruleId === ruleId);
}

describe("deterministic suggestions", () => {
  it("generates six evidence-backed categories from explicit facts and snapshot relationships", () => {
    const input = snapshotCopy();
    const featureWorkflow = workflowFact({
      jobs: [
        {
          id: "test",
          name: "Test",
          needs: [],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: false,
          isTestGate: true,
        },
        {
          id: "deploy",
          name: "Deploy",
          needs: [],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: true,
          isTestGate: false,
        },
      ],
    });
    const brokenWorkflow = workflowFact({
      jobs: [
        {
          id: "build",
          name: "Build",
          needs: ["gone"],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: false,
          isTestGate: false,
        },
      ],
    });
    const ruleFacts: RuleDiscoveryFacts = {
      ...facts(featureWorkflow),
      workflows: [featureWorkflow, brokenWorkflow],
      coverage: { dependencyResolutionComplete: true, workspaceManifestsComplete: true },
      dependencies: [
        {
          componentId: "cmp-pkg-one",
          name: "example-helper",
          version: "1.0.0",
          workspacePath: "apps/api",
          manifestEvidenceId: "ev-manifest",
          lockEvidenceId: "ev-lock",
        },
        {
          componentId: "cmp-pkg-two",
          name: "example-helper",
          version: "2.0.0",
          workspacePath: "apps/api",
          manifestEvidenceId: "ev-manifest",
          lockEvidenceId: "ev-lock",
        },
      ],
      workspaces: [
        {
          componentId: "cmp-web",
          path: "apps/web",
          manifestEvidenceId: "ev-manifest",
          scripts: ["build", "test"],
          formatterConfigPresent: false,
          formatterDependencyPresent: false,
        },
      ],
    };

    const suggestions = evaluateSuggestions(input, ruleFacts);
    expect(new Set(suggestions.map((suggestion) => suggestion.category))).toEqual(
      new Set(["feat", "chore", "refactor", "style", "fix", "docs"]),
    );
    expect(suggestions.every((suggestion) => suggestion.evidenceIds.length > 0)).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.ruleVersion === 1)).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.verification.length > 0)).toBe(true);
    expect(() => assertSnapshot({ ...input, suggestions })).not.toThrow();
  });

  it("finds a deploy job without a test gate on its literal needs ancestry", () => {
    const workflow = workflowFact({
      jobs: [
        {
          id: "unit-tests",
          name: "Unit tests",
          needs: [],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: false,
          isTestGate: true,
        },
        {
          id: "build",
          name: "Build",
          needs: [],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: false,
          isTestGate: false,
        },
        {
          id: "release",
          name: "Release",
          needs: ["build"],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: true,
          isTestGate: false,
        },
      ],
    });
    expect(category(evaluateSuggestions(snapshotCopy(), facts(workflow)), "FEAT-001")).toHaveLength(
      1,
    );
  });

  it("does not report a missing gate when one is an ancestor of deployment", () => {
    const workflow = workflowFact({
      jobs: [
        {
          id: "test",
          name: "Tests",
          needs: [],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: false,
          isTestGate: true,
        },
        {
          id: "deploy",
          name: "Deploy",
          needs: ["test"],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: true,
          isTestGate: false,
        },
      ],
    });
    expect(category(evaluateSuggestions(snapshotCopy(), facts(workflow)), "FEAT-001")).toHaveLength(
      0,
    );
  });

  it.each([
    { parseStatus: "partial" as const, hasDynamicNeeds: false, ambiguityReasons: [] },
    { parseStatus: "failed" as const, hasDynamicNeeds: false, ambiguityReasons: [] },
    { parseStatus: "complete" as const, hasDynamicNeeds: true, ambiguityReasons: [] },
  ])("suppresses workflow claims when parsing is incomplete or ambiguous: %o", (overrides) => {
    const workflow = workflowFact({
      ...overrides,
      jobs: [
        {
          id: "deploy",
          name: "Deploy",
          needs: ["missing"],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: true,
          isTestGate: false,
        },
      ],
    });
    const suggestions = evaluateSuggestions(snapshotCopy(), facts(workflow));
    expect(category(suggestions, "FIX-001")).toHaveLength(0);
    expect(category(suggestions, "FEAT-001")).toHaveLength(0);
  });

  it("reports literal missing workflow jobs only when source evidence resolves", () => {
    const workflow = workflowFact({
      hasDynamicNeeds: false,
      jobs: [
        {
          id: "deploy",
          name: "Deploy",
          needs: ["deleted-job"],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: true,
          isTestGate: false,
        },
      ],
    });
    expect(category(evaluateSuggestions(snapshotCopy(), facts(workflow)), "FIX-001")).toHaveLength(
      1,
    );

    const missingEvidence = workflowFact({ workflowEvidenceId: "ev-does-not-exist" });
    expect(
      category(evaluateSuggestions(snapshotCopy(), facts(missingEvidence)), "FIX-001"),
    ).toHaveLength(0);
  });

  it("still reports a literal missing prerequisite from a completed workflow", () => {
    const workflow = workflowFact({
      ambiguityReasons: ["A literal job prerequisite did not match a declared job ID."],
      jobs: [
        {
          id: "deploy",
          name: "Deploy",
          needs: ["gone"],
          missingNeeds: ["gone"],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: true,
          isTestGate: false,
        },
      ],
    });
    expect(category(evaluateSuggestions(snapshotCopy(), facts(workflow)), "FIX-001")).toHaveLength(
      1,
    );
  });

  it("reports duplicate package resolutions only in the same workspace", () => {
    const packageFacts = [
      {
        componentId: "cmp-pkg-one",
        name: "example-helper",
        version: "1.0.0",
        workspacePath: "apps/api",
        manifestEvidenceId: "ev-manifest",
        lockEvidenceId: "ev-lock",
      },
      {
        componentId: "cmp-pkg-two",
        name: "example-helper",
        version: "2.0.0",
        workspacePath: "apps/api",
        manifestEvidenceId: "ev-manifest",
        lockEvidenceId: "ev-lock",
      },
      {
        componentId: "cmp-pkg-one",
        name: "example-helper",
        version: "1.0.0",
        workspacePath: "apps/another",
        manifestEvidenceId: "ev-manifest",
        lockEvidenceId: "ev-lock",
      },
    ];
    const suggestions = evaluateSuggestions(snapshotCopy(), {
      dependencies: packageFacts,
      coverage: { dependencyResolutionComplete: true },
    });
    expect(category(suggestions, "CHORE-001")).toHaveLength(1);
    expect(category(suggestions, "CHORE-001")[0]?.targetIds).toEqual([
      "cmp-pkg-one",
      "cmp-pkg-two",
    ]);
  });

  it("suppresses package and style findings when their collector coverage is incomplete", () => {
    const dependencies = [
      {
        componentId: "cmp-pkg-one",
        name: "example-helper",
        version: "1.0.0",
        workspacePath: "apps/api",
        manifestEvidenceId: "ev-manifest",
        lockEvidenceId: "ev-lock",
      },
      {
        componentId: "cmp-pkg-two",
        name: "example-helper",
        version: "2.0.0",
        workspacePath: "apps/api",
        manifestEvidenceId: "ev-manifest",
        lockEvidenceId: "ev-lock",
      },
    ];
    const workspace = {
      componentId: "cmp-web",
      path: "apps/web",
      manifestEvidenceId: "ev-manifest",
      scripts: [],
      formatterConfigPresent: false,
      formatterDependencyPresent: false,
    };
    const suggestions = evaluateSuggestions(snapshotCopy(), {
      dependencies,
      workspaces: [workspace],
      coverage: { dependencyResolutionComplete: false, workspaceManifestsComplete: false },
    });
    expect(category(suggestions, "CHORE-001")).toHaveLength(0);
    expect(category(suggestions, "STYLE-001")).toHaveLength(0);
  });

  it("does not label a duplicate resolution when package evidence is missing", () => {
    const suggestions = evaluateSuggestions(snapshotCopy(), {
      coverage: { dependencyResolutionComplete: true },
      dependencies: [
        {
          componentId: "cmp-pkg-one",
          name: "example-helper",
          version: "1.0.0",
          workspacePath: "apps/api",
          manifestEvidenceId: "ev-manifest",
          lockEvidenceId: "missing-lock-evidence",
        },
        {
          componentId: "cmp-pkg-two",
          name: "example-helper",
          version: "2.0.0",
          workspacePath: "apps/api",
          manifestEvidenceId: "ev-manifest",
          lockEvidenceId: "ev-lock",
        },
      ],
    });
    expect(category(suggestions, "CHORE-001")).toHaveLength(0);
  });

  it("reports a complete application manifest scan with no declared formatting convention", () => {
    const workspace = {
      componentId: "cmp-web",
      path: "apps/web",
      manifestEvidenceId: "ev-manifest",
      scripts: ["build", "test"],
      formatterConfigPresent: false,
      formatterDependencyPresent: false,
    };
    expect(
      category(
        evaluateSuggestions(snapshotCopy(), {
          workspaces: [workspace],
          coverage: { workspaceManifestsComplete: true },
        }),
        "STYLE-001",
      ),
    ).toHaveLength(1);
    expect(
      category(
        evaluateSuggestions(snapshotCopy(), {
          workspaces: [{ ...workspace, scripts: ["build", "format:check"] }],
          coverage: { workspaceManifestsComplete: true },
        }),
        "STYLE-001",
      ),
    ).toHaveLength(0);
    expect(
      category(
        evaluateSuggestions(snapshotCopy(), {
          workspaces: [{ ...workspace, formatterConfigPresent: true }],
          coverage: { workspaceManifestsComplete: true },
        }),
        "STYLE-001",
      ),
    ).toHaveLength(0);
  });

  it("reports explicit cycles among non-package components and excludes package cycles", () => {
    const input = snapshotCopy();
    const cycleFindings = category(evaluateSuggestions(input), "REFACTOR-001");
    expect(cycleFindings).toHaveLength(1);
    expect(cycleFindings[0]?.targetIds).toEqual(["cmp-api", "cmp-worker"]);

    input.relationships = input.relationships.filter(
      (relationship) => relationship.fromId !== "cmp-api" && relationship.fromId !== "cmp-worker",
    );
    input.relationships.push(
      {
        id: "package-cycle-a",
        fromId: "cmp-pkg-one",
        toId: "cmp-pkg-two",
        type: "depends_on",
        environmentIds: ["env-local"],
        confidence: "high",
        evidenceIds: ["ev-lock"],
      },
      {
        id: "package-cycle-b",
        fromId: "cmp-pkg-two",
        toId: "cmp-pkg-one",
        type: "depends_on",
        environmentIds: ["env-local"],
        confidence: "high",
        evidenceIds: ["ev-lock"],
      },
    );
    expect(category(evaluateSuggestions(input), "REFACTOR-001")).toHaveLength(0);
  });

  it("does not emit a cycle finding when edge evidence cannot be resolved", () => {
    const input = snapshotCopy();
    input.relationships
      .filter(
        (relationship) => relationship.fromId === "cmp-api" || relationship.fromId === "cmp-worker",
      )
      .forEach((relationship) => {
        relationship.evidenceIds = ["missing-evidence"];
      });
    expect(category(evaluateSuggestions(input), "REFACTOR-001")).toHaveLength(0);
  });

  it("creates documentation findings for partial records and suppresses complete records", () => {
    const input = snapshotCopy();
    const docsSuggestions = category(evaluateSuggestions(input), "DOCS-001");
    expect(docsSuggestions.some((suggestion) => suggestion.targetIds.includes("cmp-node"))).toBe(
      true,
    );

    const serviceRecord = input.documentation.find(
      (record) => record.componentId === "cmp-service",
    )!;
    serviceRecord.status = "complete";
    expect(
      category(evaluateSuggestions(input), "DOCS-001").some((suggestion) =>
        suggestion.targetIds.includes("cmp-service"),
      ),
    ).toBe(false);
  });

  it("returns stable fingerprints and stable ordering for unchanged facts", () => {
    const input = snapshotCopy();
    const ruleFacts = {
      ...facts(
        workflowFact({
          jobs: [
            {
              id: "deploy",
              name: "Deploy",
              needs: [],
              sourceEvidenceId: "ev-workflow",
              deploysTarget: true,
              isTestGate: false,
            },
          ],
        }),
      ),
      coverage: { dependencyResolutionComplete: true },
      dependencies: [
        {
          componentId: "cmp-pkg-one",
          name: "example-helper",
          version: "1.0.0",
          workspacePath: "apps/api",
          manifestEvidenceId: "ev-manifest",
          lockEvidenceId: "ev-lock",
        },
        {
          componentId: "cmp-pkg-two",
          name: "example-helper",
          version: "2.0.0",
          workspacePath: "apps/api",
          manifestEvidenceId: "ev-manifest",
          lockEvidenceId: "ev-lock",
        },
      ],
    };
    const first = evaluateSuggestions(input, ruleFacts);
    const reordered = snapshotCopy();
    reordered.components.reverse();
    reordered.evidence.reverse();
    reordered.relationships.reverse();
    const second = evaluateSuggestions(reordered, {
      ...ruleFacts,
      workflows: [...(ruleFacts.workflows ?? [])].reverse(),
      dependencies: [...(ruleFacts.dependencies ?? [])].reverse(),
    });
    expect(second.map((suggestion) => suggestion.fingerprint)).toEqual(
      first.map((suggestion) => suggestion.fingerprint),
    );
    expect(new Set(first.map((suggestion) => suggestion.fingerprint)).size).toBe(first.length);
    expect(first.map((suggestion) => suggestion.priority)).toEqual(
      [...first.map((suggestion) => suggestion.priority)].sort((left, right) => {
        const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
        return rank[left] - rank[right];
      }),
    );
  });

  it("deduplicates repeated normalized facts into one suggestion identity", () => {
    const workflow = workflowFact({
      jobs: [
        {
          id: "deploy",
          name: "Deploy",
          needs: ["missing-job"],
          sourceEvidenceId: "ev-workflow",
          deploysTarget: true,
          isTestGate: false,
        },
      ],
    });
    const findings = category(
      evaluateSuggestions(snapshotCopy(), { workflows: [workflow, structuredClone(workflow)] }),
      "FIX-001",
    );
    expect(findings).toHaveLength(1);
  });
});
