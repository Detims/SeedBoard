import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "@modernizer/contracts";
import demoSnapshot from "../../../fixtures/demo.snapshot.json";
import { LocalApiError, LocalApiSnapshotSource } from "../src/apiSnapshotSource.js";
import { demoSnapshotSource } from "../src/snapshotSource.js";

const projects = [
  { id: "project-a", name: "Project Alpha", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "project-b", name: "Project Beta", createdAt: "2026-01-02T00:00:00.000Z" },
  { id: "project-empty", name: "Unscanned Project", createdAt: "2026-01-03T00:00:00.000Z" },
];

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "test-request" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setupSource() {
  const storage = new Map<string, string>();
  const urls: string[] = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url === "/api/v1/session") {
        return response({ csrfHeader: "x-modernizer-request", csrfValue: "same-origin" });
      }
      if (url === "/api/v1/projects") return response(projects);
      if (url === "/api/v1/projects/project-b/snapshots?limit=1") {
        return response([{ id: "snapshot-b-latest" }]);
      }
      if (url === "/api/v1/projects/project-empty/snapshots?limit=1") return response([]);
      if (url === "/api/v1/snapshots/snapshot-b-latest") {
        return response({
          ...structuredClone(demoSnapshot as Snapshot),
          projectId: "project-b",
          demo: false,
        });
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found." } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return { source: new LocalApiSnapshotSource(), storage, urls };
}

describe("local API project switching", () => {
  it("lists registered projects for the workspace menu", async () => {
    const { source } = setupSource();

    await expect(source.listProjects()).resolves.toEqual(projects);
  });

  it("remembers the selected project and loads its latest snapshot", async () => {
    const { source, storage, urls } = setupSource();

    const snapshot = await source.selectProject("project-b");

    expect(snapshot.projectId).toBe("project-b");
    expect(storage.get("modernizer:last-project")).toBe("project-b");
    expect(urls).toContain("/api/v1/projects/project-b/snapshots?limit=1");
    expect(urls).toContain("/api/v1/snapshots/snapshot-b-latest");
  });

  it("keeps an unscanned project selected and returns the first-scan guidance", async () => {
    const { source, storage } = setupSource();

    await expect(source.selectProject("project-empty")).rejects.toMatchObject({
      code: "SNAPSHOT_EMPTY",
      message: expect.stringContaining("Run the first scan"),
    } satisfies Partial<LocalApiError>);
    expect(storage.get("modernizer:last-project")).toBe("project-empty");
  });

  it("keeps demo mode out of local project switching", () => {
    expect(demoSnapshotSource.listProjects).toBeUndefined();
    expect(demoSnapshotSource.selectProject).toBeUndefined();
  });
});
