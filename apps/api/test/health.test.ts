import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@modernizer/contracts";
import { buildApp } from "../src/app.js";
import { ModernizerStore, type RegisteredProject } from "../src/storage.js";
import type { ScanRunner } from "../src/scanQueue.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const demoSnapshot = JSON.parse(
  await readFile(resolve(repoRoot, "fixtures/demo.snapshot.json"), "utf8"),
) as Snapshot;
const origin = "http://127.0.0.1:4317";
const host = "127.0.0.1:4317";

let store: ModernizerStore;
let project: RegisteredProject;
let root: string;
let app: ReturnType<typeof buildApp>;
let cookie: string;

function authHeaders(extra: Record<string, string> = {}) {
  return {
    host,
    origin,
    "sec-fetch-site": "same-origin",
    cookie,
    "x-modernizer-request": "same-origin",
    ...extra,
  };
}

async function waitForTerminal(jobId: string) {
  const end = Date.now() + 2_000;
  while (Date.now() < end) {
    const job = store.getScanJob(jobId);
    if (job && !["queued", "running", "cancelling"].includes(job.state)) return job;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error("Scan did not reach a terminal state in time.");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "modernizer-api-target-"));
  store = new ModernizerStore({ databasePath: ":memory:" });
  project = await store.registerProject({ rootPath: root, name: "Synthetic target" });
  const scanner: ScanRunner = async (registered) => ({
    snapshot: {
      ...structuredClone(demoSnapshot),
      id: `snapshot-${registered.id.slice(-12)}`,
      projectId: registered.id,
      demo: false,
    },
  });
  app = buildApp({
    store,
    scanner,
    secureCookies: false,
    advisoryFetch: async () => {
      throw new Error("No public metadata lookup should run for the synthetic fixture.");
    },
  });
  const session = await app.inject({
    method: "GET",
    url: "/api/v1/session",
    headers: { host, origin, "sec-fetch-site": "same-origin" },
  });
  expect(session.statusCode).toBe(200);
  cookie = String(session.headers["set-cookie"]).split(";", 1)[0]!;
});

afterEach(async () => {
  await app.close();
  store.close();
  await rm(root, { recursive: true, force: true });
});

describe("local API security and envelopes", () => {
  it("keeps Modernizer readiness separate from target health", async () => {
    const health = await app.inject({
      method: "GET",
      url: "/api/v1/healthz",
      headers: { host },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().data).toEqual({ service: "modernizer-api", ready: true });

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { host },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe("SESSION_REQUIRED");
    expect(missing.json().meta.requestId).toBeTruthy();
  });

  it("rejects invalid hosts, foreign origins, and missing CSRF headers", async () => {
    const wrongHost = await app.inject({
      method: "GET",
      url: "/api/v1/healthz",
      headers: { host: "attacker.invalid:4317" },
    });
    expect(wrongHost.statusCode).toBe(403);
    expect(wrongHost.json().error.code).toBe("HOST_REJECTED");

    const wrongOrigin = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: {
        host,
        origin: "http://attacker.invalid",
        cookie,
        "x-modernizer-request": "same-origin",
      },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json().error.code).toBe("ORIGIN_REJECTED");

    const noCsrfHeader = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { host, origin, cookie },
    });
    expect(noCsrfHeader.statusCode).toBe(403);
    expect(noCsrfHeader.json().error.code).toBe("REQUEST_HEADER_REQUIRED");
  });

  it("registers a project through same-origin API requests without exposing its root", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders({ "content-type": "application/json" }),
      payload: { rootPath: root, name: "Registered from dashboard" },
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().data).toMatchObject({
      id: project.id,
      name: "Registered from dashboard",
    });
    expect(registered.body).not.toContain(root);
    expect(registered.json().data).not.toHaveProperty("rootPath");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      { id: project.id, name: "Registered from dashboard", createdAt: project.createdAt },
    ]);
    expect(response.body).not.toContain(root);
  });

  it("rejects invalid project registrations", async () => {
    const missingRoot = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders({ "content-type": "application/json" }),
      payload: { rootPath: join(root, "missing") },
    });
    expect(missingRoot.statusCode).toBe(400);
    expect(missingRoot.json().error.code).toBe("BAD_REQUEST");

    const controlCharacter = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders({ "content-type": "application/json" }),
      payload: { rootPath: `invalid\u0000path` },
    });
    expect(controlCharacter.statusCode).toBe(400);

    const unexpectedField = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders({ "content-type": "application/json" }),
      payload: { rootPath: root, extra: true },
    });
    expect(unexpectedField.statusCode).toBe(400);
  });

  it("bounds pagination and requires JSON for mutation requests", async () => {
    const badLimit = await app.inject({
      method: "GET",
      url: "/api/v1/projects/unknown/snapshots?limit=201",
      headers: authHeaders(),
    });
    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.json().error.code).toBe("BAD_REQUEST");

    const badContent = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/scans`,
      headers: authHeaders({ "content-type": "text/plain" }),
      payload: "{}",
    });
    expect(badContent.statusCode).toBe(400);
    expect(badContent.json().error.code).toBe("JSON_REQUIRED");
  });
});

describe("local snapshot and decision APIs", () => {
  async function runScan(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/scans`,
      headers: authHeaders({ "content-type": "application/json" }),
      payload: {},
    });
    expect(response.statusCode).toBe(202);
    const job = await waitForTerminal(response.json().data.id as string);
    expect(job.state).toBe("succeeded");
    return job.snapshotId!;
  }

  it("publishes a validated snapshot and compares its immutable history", async () => {
    const snapshotId = await runScan();
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/snapshots`,
      headers: authHeaders(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);

    const snapshot = await app.inject({
      method: "GET",
      url: `/api/v1/snapshots/${snapshotId}`,
      headers: authHeaders(),
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().data.projectId).toBe(project.id);

    const diff = await app.inject({
      method: "GET",
      url: `/api/v1/snapshots/${snapshotId}/diff?base=${snapshotId}`,
      headers: authHeaders(),
    });
    expect(diff.statusCode).toBe(200);
    expect(diff.json().data.added).toEqual([]);
    expect(diff.json().data.changed).toEqual([]);

    const appendix = await app.inject({
      method: "GET",
      url: `/api/v1/snapshots/${snapshotId}/export?format=appendix`,
      headers: authHeaders(),
    });
    expect(appendix.statusCode).toBe(200);
    expect(appendix.headers["content-type"]).toContain("text/markdown");
    expect(appendix.body.toLowerCase()).toContain("documentation appendix");
    expect(appendix.body).not.toContain(root);
  });

  it("requires explicit consent before checking external package metadata", async () => {
    const snapshotId = await runScan();
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/snapshots/${snapshotId}/package-advisories`,
      headers: authHeaders({ "content-type": "application/json" }),
      payload: { shareMetadata: false },
    });
    expect(rejected.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/snapshots/${snapshotId}/package-advisories`,
      headers: authHeaders({ "content-type": "application/json" }),
      payload: { shareMetadata: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.checkedAt).toBeTruthy();
    expect(accepted.json().data.packages).toEqual([]);
  });

  it("saves bounded graph layouts and human decisions without applying findings", async () => {
    await runScan();

    const layout = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/layouts/main`,
      headers: authHeaders({ "content-type": "application/json" }),
      payload: {
        positions: { "cmp-web": { x: 100, y: 200 } },
        viewport: { x: 0, y: 0, zoom: 1 },
        pinnedIds: ["cmp-web"],
      },
    });
    expect(layout.statusCode).toBe(200);
    expect(layout.json().data.version).toBe(1);

    const unknownComponent = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/layouts/main`,
      headers: authHeaders({ "content-type": "application/json" }),
      payload: {
        positions: { "../outside": { x: 100, y: 200 } },
        viewport: { x: 0, y: 0, zoom: 1 },
        pinnedIds: [],
      },
    });
    expect(unknownComponent.statusCode).toBe(400);

    const decision = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/suggestion-decisions/demo-FIX-001-v1`,
      headers: authHeaders({ "content-type": "application/json" }),
      payload: { state: "accepted", reason: "Reviewed; add to backlog." },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().data.state).toBe("accepted");
    expect(decision.json().data).not.toHaveProperty("applied");
  });

  it("keeps the last good snapshot when a new result fails semantic validation", async () => {
    await runScan();
    expect(store.listSnapshots(project.id, { limit: 10 }).snapshots).toHaveLength(1);

    const job = store.createScanJob(project.id);
    store.updateScanJob(job.id, { state: "running", stage: "testing" });
    const invalid = structuredClone(demoSnapshot);
    invalid.projectId = project.id;
    invalid.id = "invalid-publication";
    invalid.documentation = [];
    expect(() => store.publishSnapshot(job.id, invalid)).toThrow(/documentation record/);
    expect(store.listSnapshots(project.id, { limit: 10 }).snapshots).toHaveLength(1);
    expect(store.getScanJob(job.id)?.state).toBe("running");
  });
});
