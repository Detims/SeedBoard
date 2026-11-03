import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSnapshot } from "../src/index.js";
import type { Snapshot } from "../src/generated.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureNames = ["empty.snapshot.json", "partial.snapshot.json", "rules.snapshot.json"];

describe("reference snapshots", () => {
  it.each(fixtureNames)("validates %s against the shared contracts", async (name) => {
    const input = JSON.parse(
      await readFile(resolve(repoRoot, "fixtures", name), "utf8"),
    ) as Snapshot;
    expect(validateSnapshot(input)).toEqual({ valid: true, issues: [] });
  });
});
