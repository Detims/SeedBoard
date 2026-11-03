import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/demo.snapshot.json";
import { assertSnapshot, type Snapshot } from "@modernizer/contracts";
import { createGuideStub, exportBacklogMarkdown, exportDocumentationAppendix, exportSnapshotJson, resolveDocumentation } from "../src/index.js";

assertSnapshot(fixture);
const snapshot = fixture as Snapshot;

describe("documentation and sanitized exports", () => {
  it("resolves one documentation record for every component", () => {
    expect(resolveDocumentation(snapshot)).toHaveLength(snapshot.components.length);
    expect(new Set(resolveDocumentation(snapshot).map((item) => item.componentId)).size).toBe(snapshot.components.length);
  });
  it("creates an explicit internal guide stub for undocumented components", () => {
    const item = snapshot.components[0]!;
    expect(createGuideStub(snapshot, item.id)).toContain("Open questions");
    expect(createGuideStub(snapshot, "missing")).toBeNull();
  });
  it("escapes malicious labels and removes URL credentials, queries, and unsafe paths", () => {
    const hostile = structuredClone(snapshot) as Snapshot;
    hostile.components[0]!.name = "[x](javascript:alert(1))";
    hostile.documentation[0]!.officialReferences = [{ title: "bad ](url)", url: "https://user:secret@example.test/doc?token=secret", verifiedAt: null }];
    hostile.documentation[0]!.internalPaths = ["../escape", "guide.md"];
    const json = exportSnapshotJson(hostile);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("../escape");
    expect(exportDocumentationAppendix(hostile)).not.toContain("](javascript:");
    expect(exportBacklogMarkdown(hostile)).toContain("review-only");
  });
});
