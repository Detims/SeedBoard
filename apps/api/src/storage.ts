import { createHash, randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSnapshot, type Snapshot } from "@modernizer/contracts";

const currentSchemaVersion = 1;
const migrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../database/migrations/0001-initial.sql",
);

export type ScanState =
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";

export type RegisteredProject = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = Omit<RegisteredProject, "rootPath" | "updatedAt">;

export type ScanProgress = {
  completed: number;
  total: number | null;
};

export type ScanJob = {
  id: string;
  projectId: string;
  state: ScanState;
  stage: string;
  progress: ScanProgress;
  issues: string[];
  snapshotId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SnapshotSummary = {
  id: string;
  projectId: string;
  capturedAt: string;
  assessmentStatus: "complete" | "partial";
  componentCount: number;
  relationshipCount: number;
  sourceRevision: string | null;
};

export type LayoutInput = {
  positions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
  pinnedIds: string[];
};

export type SavedLayout = LayoutInput & {
  projectId: string;
  name: string;
  version: number;
  updatedAt: string;
};

export type SuggestionDecision = {
  projectId: string;
  fingerprint: string;
  state: "open" | "accepted" | "dismissed";
  reason: string;
  updatedAt: string;
};

type Row = Record<string, SQLOutputValue>;
type Clock = () => string;

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new TypeError(`Expected text column ${column}.`);
  return value;
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`Expected integer column ${column}.`);
  }
  return value;
}

function nullableInteger(row: Row, column: string): number | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`Expected nullable integer column ${column}.`);
  }
  return value;
}

function jsonList<T>(value: SQLOutputValue | undefined): T {
  if (typeof value !== "string") throw new TypeError("Expected JSON text.");
  return JSON.parse(value) as T;
}

function rowOrNull(value: Row | undefined): Row | null {
  return value ?? null;
}

export function defaultDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MODERNIZER_DATA_DIR) return resolve(env.MODERNIZER_DATA_DIR);
  if (process.platform === "win32") {
    const local = env.LOCALAPPDATA;
    if (!local) throw new Error("LOCALAPPDATA is required to choose the local data folder.");
    return resolve(local, "Modernizer");
  }
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "Modernizer");
  }
  return resolve(env.XDG_DATA_HOME || resolve(homedir(), ".local", "share"), "modernizer");
}

function migrate(db: DatabaseSync): void {
  const versionRow = db.prepare("PRAGMA user_version").get() as Row | undefined;
  const version = versionRow ? integer(versionRow, "user_version") : 0;
  if (version > currentSchemaVersion) {
    throw new Error(
      `Modernizer database schema ${version} is newer than supported schema ${currentSchemaVersion}.`,
    );
  }
  if (version === currentSchemaVersion) return;

  const migrationSql = readFileSync(migrationPath, "utf8");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(migrationSql);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function configureDatabase(db: DatabaseSync): DatabaseSync {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 2000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = FULL;");
  migrate(db);
  return db;
}

function openMemoryDatabase(): DatabaseSync {
  return configureDatabase(new DatabaseSync(":memory:"));
}

function openFileDatabase(databasePath: string): DatabaseSync {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  try {
    if (process.platform !== "win32") chmodSync(databasePath, 0o600);
    return configureDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
}

export class ModernizerStore {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;

  constructor(options: { databasePath?: string; clock?: Clock } = {}) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
    const path = options.databasePath ?? resolve(defaultDataDirectory(), "modernizer.sqlite");
    if (path === ":memory:") {
      this.#db = openMemoryDatabase();
    } else {
      this.#db = openFileDatabase(path);
    }
  }

  close(): void {
    this.#db.close();
  }

  async registerProject(input: { rootPath: string; name?: string }): Promise<RegisteredProject> {
    const root = await realpath(resolve(input.rootPath));
    if (!(await stat(root)).isDirectory()) {
      throw new TypeError("The selected project root must be an existing directory.");
    }
    const identity = process.platform === "win32" ? root.toLowerCase() : root;
    const rootHash = createHash("sha256").update(identity).digest("hex");
    const id = `project-${rootHash.slice(0, 32)}`;
    const now = this.#clock();
    const name = normalizeName(
      input.name ?? root.split(/[\\/]/).filter(Boolean).at(-1) ?? "Project",
    );

    this.#db
      .prepare(
        `INSERT INTO projects (id, name, root_path, root_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(root_hash) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      )
      .run(id, name, root, rootHash, now, now);

    const project = this.getProject(id);
    if (!project) throw new Error("Project registration did not persist.");
    return project;
  }

  listProjects(): ProjectSummary[] {
    const rows = this.#db
      .prepare("SELECT id, name, created_at FROM projects ORDER BY name COLLATE NOCASE, id")
      .all() as Row[];
    return rows.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
      createdAt: text(row, "created_at"),
    }));
  }

  getProject(projectId: string): RegisteredProject | null {
    const row = rowOrNull(
      this.#db
        .prepare("SELECT id, name, root_path, created_at, updated_at FROM projects WHERE id = ?")
        .get(projectId) as Row | undefined,
    );
    if (!row) return null;
    return {
      id: text(row, "id"),
      name: text(row, "name"),
      rootPath: text(row, "root_path"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    };
  }

  markInterruptedJobs(): void {
    const now = this.#clock();
    this.#db
      .prepare(
        `UPDATE scan_jobs
         SET state = 'interrupted', stage = 'interrupted', updated_at = ?
         WHERE state IN ('queued', 'running', 'cancelling')`,
      )
      .run(now);
  }

  createScanJob(projectId: string): ScanJob {
    if (!this.getProject(projectId)) throw new ResourceNotFoundError("Project not found.");
    const now = this.#clock();
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO scan_jobs
          (id, project_id, state, stage, progress_completed, progress_total, issues_json, snapshot_id, created_at, updated_at)
         VALUES (?, ?, 'queued', 'queued', 0, NULL, '[]', NULL, ?, ?)`,
      )
      .run(id, projectId, now, now);
    const job = this.getScanJob(id);
    if (!job) throw new Error("Scan job did not persist.");
    return job;
  }

  getScanJob(jobId: string): ScanJob | null {
    const row = rowOrNull(
      this.#db
        .prepare(
          `SELECT id, project_id, state, stage, progress_completed, progress_total,
             issues_json, snapshot_id, created_at, updated_at
           FROM scan_jobs WHERE id = ?`,
        )
        .get(jobId) as Row | undefined,
    );
    return row ? this.#scanJob(row) : null;
  }

  listActiveJobs(): ScanJob[] {
    const rows = this.#db
      .prepare(
        `SELECT id, project_id, state, stage, progress_completed, progress_total,
           issues_json, snapshot_id, created_at, updated_at
         FROM scan_jobs WHERE state IN ('queued', 'running', 'cancelling')
         ORDER BY created_at, id`,
      )
      .all() as Row[];
    return rows.map((row) => this.#scanJob(row));
  }

  updateScanJob(
    jobId: string,
    update: {
      state?: ScanState;
      stage?: string;
      progress?: ScanProgress;
      issues?: string[];
    },
  ): ScanJob {
    const existing = this.getScanJob(jobId);
    if (!existing) throw new ResourceNotFoundError("Scan not found.");
    const nextState = update.state ?? existing.state;
    if (!allowedScanTransitions[existing.state].has(nextState)) {
      throw new ScanConflictError(`Cannot move a scan from ${existing.state} to ${nextState}.`);
    }
    const now = this.#clock();
    this.#db
      .prepare(
        `UPDATE scan_jobs SET
           state = ?, stage = ?, progress_completed = ?, progress_total = ?, issues_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        nextState,
        update.stage ?? existing.stage,
        update.progress?.completed ?? existing.progress.completed,
        update.progress ? update.progress.total : existing.progress.total,
        JSON.stringify(update.issues ?? existing.issues),
        now,
        jobId,
      );
    const job = this.getScanJob(jobId);
    if (!job) throw new Error("Scan job disappeared.");
    return job;
  }

  cancelQueuedJob(jobId: string): ScanJob {
    const job = this.getScanJob(jobId);
    if (!job) throw new ResourceNotFoundError("Scan not found.");
    if (job.state === "queued") {
      return this.updateScanJob(jobId, { state: "cancelled", stage: "cancelled" });
    }
    if (job.state === "running") {
      return this.updateScanJob(jobId, { state: "cancelling", stage: "cancelling" });
    }
    return job;
  }

  publishSnapshot(jobId: string, snapshotInput: unknown): SnapshotSummary {
    assertSnapshot(snapshotInput);
    const snapshot = snapshotInput as Snapshot;
    assertSafeSnapshotUrls(snapshot);
    const job = this.getScanJob(jobId);
    if (!job) throw new ResourceNotFoundError("Scan not found.");
    if (job.state !== "running") throw new ScanConflictError("Only a running scan can publish.");
    if (snapshot.projectId !== job.projectId) {
      throw new TypeError("Snapshot project does not match scan project.");
    }

    const hasCoverageGap = snapshot.coverage.some(
      ({ status }) => status === "failed" || status === "unsupported",
    );
    const assessmentStatus = hasCoverageGap ? "partial" : "complete";
    const publish = this.#db.prepare(
      `INSERT INTO snapshots
        (id, project_id, scan_job_id, schema_version, assessment_status, captured_at,
         source_revision, component_count, relationship_count, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const finish = this.#db.prepare(
      `UPDATE scan_jobs SET state = ?, stage = 'complete', snapshot_id = ?, updated_at = ? WHERE id = ? AND state = 'running'`,
    );
    const now = this.#clock();

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      publish.run(
        snapshot.id,
        snapshot.projectId,
        jobId,
        snapshot.schemaVersion,
        assessmentStatus,
        snapshot.capturedAt,
        snapshot.sourceRevision,
        snapshot.components.length,
        snapshot.relationships.length,
        JSON.stringify(snapshot),
      );
      finish.run(assessmentStatus === "partial" ? "partial" : "succeeded", snapshot.id, now, jobId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return {
      id: snapshot.id,
      projectId: snapshot.projectId,
      capturedAt: snapshot.capturedAt,
      assessmentStatus,
      componentCount: snapshot.components.length,
      relationshipCount: snapshot.relationships.length,
      sourceRevision: snapshot.sourceRevision,
    };
  }

  listSnapshots(
    projectId: string,
    options: { limit: number; cursor?: string },
  ): { snapshots: SnapshotSummary[]; nextCursor: string | null } {
    if (!this.getProject(projectId)) throw new ResourceNotFoundError("Project not found.");
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200) {
      throw new TypeError("Limit must be an integer between 1 and 200.");
    }
    let cursor: { capturedAt: string; id: string } | null = null;
    if (options.cursor) cursor = decodeCursor(options.cursor);
    const rows = cursor
      ? (this.#db
          .prepare(
            `SELECT id, project_id, captured_at, assessment_status, component_count,
               relationship_count, source_revision
             FROM snapshots WHERE project_id = ?
               AND (captured_at < ? OR (captured_at = ? AND id < ?))
             ORDER BY captured_at DESC, id DESC LIMIT ?`,
          )
          .all(
            projectId,
            cursor.capturedAt,
            cursor.capturedAt,
            cursor.id,
            options.limit + 1,
          ) as Row[])
      : (this.#db
          .prepare(
            `SELECT id, project_id, captured_at, assessment_status, component_count,
               relationship_count, source_revision
             FROM snapshots WHERE project_id = ?
             ORDER BY captured_at DESC, id DESC LIMIT ?`,
          )
          .all(projectId, options.limit + 1) as Row[]);
    const hasNext = rows.length > options.limit;
    const page = rows.slice(0, options.limit).map((row) => this.#snapshotSummary(row));
    const last = page.at(-1);
    return {
      snapshots: page,
      nextCursor:
        hasNext && last ? encodeCursor({ capturedAt: last.capturedAt, id: last.id }) : null,
    };
  }

  getSnapshot(snapshotId: string): { summary: SnapshotSummary; snapshot: Snapshot } | null {
    const row = rowOrNull(
      this.#db
        .prepare(
          `SELECT id, project_id, captured_at, assessment_status, component_count,
             relationship_count, source_revision, snapshot_json
           FROM snapshots WHERE id = ?`,
        )
        .get(snapshotId) as Row | undefined,
    );
    if (!row) return null;
    const snapshot = jsonList<unknown>(row.snapshot_json);
    assertSnapshot(snapshot);
    return { summary: this.#snapshotSummary(row), snapshot };
  }

  saveLayout(projectId: string, name: string, layout: LayoutInput): SavedLayout {
    if (!this.getProject(projectId)) throw new ResourceNotFoundError("Project not found.");
    const snapshotPage = this.listSnapshots(projectId, { limit: 1 }).snapshots;
    const latest = snapshotPage[0] ? this.getSnapshot(snapshotPage[0].id)?.snapshot : undefined;
    const componentIds = new Set(latest?.components.map(({ id }) => id) ?? []);
    for (const id of [...Object.keys(layout.positions), ...layout.pinnedIds]) {
      if (!componentIds.has(id)) {
        throw new TypeError(`Layout references unknown component "${id}".`);
      }
    }
    const prior = rowOrNull(
      this.#db
        .prepare("SELECT version FROM layouts WHERE project_id = ? AND name = ?")
        .get(projectId, name) as Row | undefined,
    );
    const version = prior ? integer(prior, "version") + 1 : 1;
    const updatedAt = this.#clock();
    this.#db
      .prepare(
        `INSERT INTO layouts
          (project_id, name, positions_json, viewport_json, pinned_ids_json, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, name) DO UPDATE SET
           positions_json = excluded.positions_json,
           viewport_json = excluded.viewport_json,
           pinned_ids_json = excluded.pinned_ids_json,
           version = excluded.version,
           updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        name,
        JSON.stringify(layout.positions),
        JSON.stringify(layout.viewport),
        JSON.stringify(layout.pinnedIds),
        version,
        updatedAt,
      );
    return { ...layout, projectId, name, version, updatedAt };
  }

  getLayout(projectId: string, name: string): SavedLayout | null {
    const row = rowOrNull(
      this.#db
        .prepare(
          `SELECT project_id, name, positions_json, viewport_json, pinned_ids_json, version, updated_at
           FROM layouts WHERE project_id = ? AND name = ?`,
        )
        .get(projectId, name) as Row | undefined,
    );
    if (!row) return null;
    return {
      projectId: text(row, "project_id"),
      name: text(row, "name"),
      positions: jsonList(row.positions_json),
      viewport: jsonList(row.viewport_json),
      pinnedIds: jsonList(row.pinned_ids_json),
      version: integer(row, "version"),
      updatedAt: text(row, "updated_at"),
    };
  }

  saveDecision(
    projectId: string,
    fingerprint: string,
    input: { state: SuggestionDecision["state"]; reason: string },
  ): SuggestionDecision {
    if (!this.getProject(projectId)) throw new ResourceNotFoundError("Project not found.");
    const snapshots = this.listSnapshots(projectId, { limit: 1 }).snapshots;
    const latest = snapshots[0] ? this.getSnapshot(snapshots[0].id)?.snapshot : null;
    if (!latest?.suggestions.some((suggestion) => suggestion.fingerprint === fingerprint)) {
      throw new ResourceNotFoundError("Suggestion not found in the latest snapshot.");
    }
    if (input.state === "dismissed" && input.reason.trim().length === 0) {
      throw new TypeError("Dismissal requires a reason.");
    }
    const updatedAt = this.#clock();
    this.#db
      .prepare(
        `INSERT INTO suggestion_decisions (project_id, fingerprint, state, reason, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, fingerprint) DO UPDATE SET
           state = excluded.state, reason = excluded.reason, updated_at = excluded.updated_at`,
      )
      .run(projectId, fingerprint, input.state, input.reason.trim(), updatedAt);
    return { projectId, fingerprint, ...input, reason: input.reason.trim(), updatedAt };
  }

  getDecision(projectId: string, fingerprint: string): SuggestionDecision | null {
    const row = rowOrNull(
      this.#db
        .prepare(
          `SELECT project_id, fingerprint, state, reason, updated_at
           FROM suggestion_decisions WHERE project_id = ? AND fingerprint = ?`,
        )
        .get(projectId, fingerprint) as Row | undefined,
    );
    if (!row) return null;
    return {
      projectId: text(row, "project_id"),
      fingerprint: text(row, "fingerprint"),
      state: text(row, "state") as SuggestionDecision["state"],
      reason: text(row, "reason"),
      updatedAt: text(row, "updated_at"),
    };
  }

  #scanJob(row: Row): ScanJob {
    const snapshotId = row.snapshot_id;
    if (snapshotId !== null && typeof snapshotId !== "string") {
      throw new TypeError("Expected nullable snapshot ID.");
    }
    return {
      id: text(row, "id"),
      projectId: text(row, "project_id"),
      state: text(row, "state") as ScanState,
      stage: text(row, "stage"),
      progress: {
        completed: integer(row, "progress_completed"),
        total: nullableInteger(row, "progress_total"),
      },
      issues: jsonList(row.issues_json),
      snapshotId,
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    };
  }

  #snapshotSummary(row: Row): SnapshotSummary {
    const sourceRevision = row.source_revision;
    if (sourceRevision !== null && typeof sourceRevision !== "string") {
      throw new TypeError("Expected nullable source revision.");
    }
    const status = text(row, "assessment_status");
    if (status !== "complete" && status !== "partial") {
      throw new TypeError("Invalid stored assessment status.");
    }
    return {
      id: text(row, "id"),
      projectId: text(row, "project_id"),
      capturedAt: text(row, "captured_at"),
      assessmentStatus: status,
      componentCount: integer(row, "component_count"),
      relationshipCount: integer(row, "relationship_count"),
      sourceRevision,
    };
  }
}

function assertSafeSnapshotUrls(snapshot: Snapshot): void {
  const urls = [
    ...snapshot.evidence.flatMap((item) => (item.url ? [item.url] : [])),
    ...snapshot.documentation.flatMap((record) =>
      record.officialReferences.map((reference) => reference.url),
    ),
  ];
  for (const value of urls) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("Snapshot contains an invalid external URL.");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError(
        "Snapshot external URLs cannot contain credentials, queries, or fragments.",
      );
    }
  }
}

function normalizeName(value: string): string {
  const name = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 200);
  if (name.length === 0) throw new TypeError("Project name must contain a visible character.");
  return name;
}

function encodeCursor(value: { capturedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor: string): { capturedAt: string; id: string } {
  if (cursor.length > 2048) throw new TypeError("Cursor is too long.");
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      capturedAt?: unknown;
      id?: unknown;
    };
    if (typeof value.capturedAt !== "string" || typeof value.id !== "string") {
      throw new Error("Malformed cursor.");
    }
    return { capturedAt: value.capturedAt, id: value.id };
  } catch {
    throw new TypeError("Cursor is invalid.");
  }
}

export function classifySnapshot(snapshot: Snapshot): "complete" | "partial" {
  return snapshot.coverage.some(({ status }) => status === "failed" || status === "unsupported")
    ? "partial"
    : "complete";
}

export class ResourceNotFoundError extends Error {}
export class ScanConflictError extends Error {}

const allowedScanTransitions: Record<ScanState, ReadonlySet<ScanState>> = {
  queued: new Set(["queued", "running", "cancelled", "interrupted", "failed"]),
  running: new Set([
    "running",
    "cancelling",
    "succeeded",
    "partial",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  cancelling: new Set(["cancelling", "cancelled", "interrupted"]),
  succeeded: new Set(["succeeded"]),
  partial: new Set(["partial"]),
  failed: new Set(["failed"]),
  cancelled: new Set(["cancelled"]),
  interrupted: new Set(["interrupted"]),
};
