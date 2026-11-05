import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/demo.snapshot.json";
import type { Snapshot } from "@modernizer/contracts";
import { checkPackageAdvisories, clearPackageAdvisoryCache } from "../src/packageAdvisories.js";

function snapshot(): Snapshot {
  const value = structuredClone(fixture) as Snapshot;
  const first = value.components.find(({ id }) => id === "cmp-pkg-one")!;
  const second = value.components.find(({ id }) => id === "cmp-pkg-two")!;
  first.name = "@sample/widget";
  first.versions[0]!.value = "1.2.0";
  second.name = "@sample/widget";
  second.versions[0]!.value = "2.0.0";
  const runtime = value.components.find(({ id }) => id === "cmp-node")!;
  runtime.versions = [
    {
      facet: "resolved",
      value: "18.20.0",
      environmentId: null,
      observedAt: "2026-01-01T00:00:00.000Z",
      evidenceIds: ["ev-manifest"],
    },
  ];
  return value;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("package status lookups", () => {
  it("compares exact package versions and reports runtime lifecycle provenance", async () => {
    clearPackageAdvisoryCache();
    const urls: string[] = [];
    const report = await checkPackageAdvisories(snapshot(), {
      now: () => new Date("2026-11-04T12:00:00.000Z"),
      fetcher: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("registry.npmjs.org")) return jsonResponse({ version: "2.0.0" });
        return jsonResponse({
          generated_at: "2026-11-04T11:55:00.000Z",
          result: {
            releases: [
              { name: "18", isEol: true, isMaintained: false, eolFrom: "2025-04-30" },
              { name: "22", isEol: false, isMaintained: true, eolFrom: "2027-04-30" },
            ],
          },
        });
      },
    });

    expect(report.checkedAt).toBe("2026-11-04T12:00:00.000Z");
    expect(report.packages.map(({ status }) => status)).toEqual(["outdated", "current"]);
    expect(report.packages[0]).toMatchObject({
      latestVersion: "2.0.0",
      sourceUrl: "https://www.npmjs.com/package/%40sample%2Fwidget",
    });
    expect(report.lifecycles[0]).toMatchObject({
      status: "eol",
      cycle: "18",
      endOfLife: "2025-04-30",
    });
    expect(report.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "npm public registry",
          retrievedAt: "2026-11-04T12:00:00.000Z",
        }),
        expect.objectContaining({
          name: "endoflife.date",
          retrievedAt: "2026-11-04T12:00:00.000Z",
        }),
      ]),
    );
    expect(urls).toContain("https://registry.npmjs.org/@sample%2fwidget/latest");
    expect(urls).toContain("https://endoflife.date/api/v1/products/nodejs");
    expect(urls).toHaveLength(2);
  });

  it("uses a short cache and keeps unavailable or unmappable data unknown", async () => {
    clearPackageAdvisoryCache();
    let calls = 0;
    const options = {
      now: () => new Date("2026-11-04T12:00:00.000Z"),
      fetcher: async (input: string | URL) => {
        calls++;
        return String(input).includes("registry.npmjs.org")
          ? jsonResponse({ version: "latest" })
          : jsonResponse({ result: { releases: [] } });
      },
    };
    const first = await checkPackageAdvisories(snapshot(), options);
    const second = await checkPackageAdvisories(snapshot(), options);

    expect(first.packages.every(({ status }) => status === "unknown")).toBe(true);
    expect(first.lifecycles[0]?.status).toBe("unknown");
    expect(second.packages.every(({ status }) => status === "unknown")).toBe(true);
    expect(calls).toBe(2);
    expect(second.sources.every(({ cached }) => cached)).toBe(true);
  });
});
