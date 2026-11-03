import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@modernizer/contracts";
import { ModernizerStore, ScanConflictError } from "../src/storage.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const demo = JSON.parse(
  await readFile(resolve(repoRoot, "fixtures/demo.snapshot.json"), "utf8"),
) as Snapshot;

let directory: string;
let targetRoot: string;
let store: ModernizerStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "modernizer-storage-"));
  targetRoot = join(directory, "target");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(targetRoot));
  store = new ModernizerStore({ databasePath: join(directory, "state.sqlite") });
});

afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

async function register() {
  return store.registerProject({ rootPath: targetRoot, name: "Fixture project" });
}

function snapshotFor(projectId: string, id: string, partial = false): Snapshot {
  const snapshot = structuredClone(demo);
  snapshot.projectId = projectId;
  snapshot.id = id;
  if (partial) {
    snapshot.coverage.push({
      collector: "unsupported-fixture",
      status: "unsupported",
      scope: "Synthetic unsupported input",
      observedAt: snapshot.capturedAt,
      reason: "Fixture exercises partial status.",
    });
  }
  return snapshot;
}

describe("Modernizer SQLite storage", () => {
  it("applies its own migration and returns project metadata without root paths", async () => {
    const project = await register();
    expect(project.rootPath).toBeTruthy();
    expect(project.id).toMatch(/^project-[a-f0-9]{32}$/);
    const listed = store.listProjects();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({
      id: project.id,
      name: "Fixture project",
      createdAt: project.createdAt,
    });
    expect(listed[0]).not.toHaveProperty("rootPath");
  });

  it("deduplicates re-registration of the same canonical folder", async () => {
    const first = await register();
    const second = await store.registerProject({ rootPath: join(targetRoot, ".") });
    expect(second.id).toBe(first.id);
    expect(store.listProjects()).toHaveLength(1);
  });

  it("marks unfinished jobs interrupted after a restart", async () => {
    const project = await register();
    const queued = store.createScanJob(project.id);
    store.updateScanJob(queued.id, { state: "running", stage: "reading-metadata" });
    store.markInterruptedJobs();
    expect(store.getScanJob(queued.id)).toMatchObject({
      state: "interrupted",
      stage: "interrupted",
      snapshotId: null,
    });
    expect(() => store.updateScanJob(queued.id, { state: "running", stage: "resume" })).toThrow(
      ScanConflictError,
    );
  });

  it("publishes snapshot and terminal state in one transaction", async () => {
    const project = await register();
    const job = store.createScanJob(project.id);
    store.updateScanJob(job.id, { state: "running", stage: "normalizing" });
    const summary = store.publishSnapshot(job.id, snapshotFor(project.id, "snapshot-full"));

    expect(summary).toMatchObject({
      id: "snapshot-full",
      projectId: project.id,
      assessmentStatus: "complete",
      componentCount: 11,
      relationshipCount: 11,
    });
    expect(store.getScanJob(job.id)).toMatchObject({
      state: "succeeded",
      snapshotId: "snapshot-full",
      stage: "complete",
    });
    expect(store.getSnapshot("snapshot-full")?.snapshot.projectId).toBe(project.id);
  });

  it("derives partial status from coverage and leaves live states unknown", async () => {
    const project = await register();
    const job = store.createScanJob(project.id);
    store.updateScanJob(job.id, { state: "running" });
    const summary = store.publishSnapshot(
      job.id,
      snapshotFor(project.id, "snapshot-partial", true),
    );
    expect(summary.assessmentStatus).toBe("partial");
    expect(
      store
        .getSnapshot("snapshot-partial")
        ?.snapshot.components.find((component) => component.kind === "database")
        ?.observations.some((observation) => observation.state === "unknown"),
    ).toBe(true);
  });

  it("does not publish semantically invalid snapshots or replace prior history", async () => {
    const project = await register();
    const first = store.createScanJob(project.id);
    store.updateScanJob(first.id, { state: "running" });
    store.publishSnapshot(first.id, snapshotFor(project.id, "snapshot-good"));

    const second = store.createScanJob(project.id);
    store.updateScanJob(second.id, { state: "running" });
    const invalid = snapshotFor(project.id, "snapshot-bad");
    invalid.relationships[0]!.toId = "unknown-component";
    expect(() => store.publishSnapshot(second.id, invalid)).toThrow(/unknown ID/);
    expect(store.listSnapshots(project.id, { limit: 20 }).snapshots.map(({ id }) => id)).toEqual([
      "snapshot-good",
    ]);
    expect(store.getScanJob(second.id)?.state).toBe("running");
  });

  it("rejects unsafe external URLs before persisting a snapshot", async () => {
    const project = await register();
    const job = store.createScanJob(project.id);
    store.updateScanJob(job.id, { state: "running" });
    const unsafe = snapshotFor(project.id, "snapshot-url");
    unsafe.evidence[0]!.url = "https://example.test/?token=private";
    expect(() => store.publishSnapshot(job.id, unsafe)).toThrow(/cannot contain credentials/);
    expect(store.listSnapshots(project.id, { limit: 10 }).snapshots).toHaveLength(0);
  });

  it("keeps snapshots immutable and persists project history when reopened", async () => {
    const project = await register();
    const job = store.createScanJob(project.id);
    store.updateScanJob(job.id, { state: "running" });
    store.publishSnapshot(job.id, snapshotFor(project.id, "snapshot-immutable"));
    store.close();

    const raw = new DatabaseSync(join(directory, "state.sqlite"));
    expect(() =>
      raw
        .prepare("UPDATE snapshots SET snapshot_json = '{}' WHERE id = ?")
        .run("snapshot-immutable"),
    ).toThrow(/immutable/);
    raw.close();

    store = new ModernizerStore({ databasePath: join(directory, "state.sqlite") });
    expect(store.listProjects()).toHaveLength(1);
    expect(store.listSnapshots(project.id, { limit: 1 }).snapshots[0]?.id).toBe(
      "snapshot-immutable",
    );
  });

  it("uses an owner-only database file mode on POSIX systems", async () => {
    if (process.platform === "win32") return;
    const { stat } = await import("node:fs/promises");
    const mode = (await stat(join(directory, "state.sqlite"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
