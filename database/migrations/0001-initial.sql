PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  root_path TEXT NOT NULL UNIQUE,
  root_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE scan_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'cancelling', 'succeeded', 'partial', 'failed', 'cancelled', 'interrupted')),
  stage TEXT NOT NULL,
  progress_completed INTEGER NOT NULL DEFAULT 0 CHECK (progress_completed >= 0),
  progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= 0),
  issues_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(issues_json)),
  snapshot_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scan_job_id TEXT NOT NULL UNIQUE REFERENCES scan_jobs(id),
  schema_version TEXT NOT NULL,
  assessment_status TEXT NOT NULL CHECK (assessment_status IN ('complete', 'partial')),
  captured_at TEXT NOT NULL,
  source_revision TEXT,
  component_count INTEGER NOT NULL CHECK (component_count >= 0),
  relationship_count INTEGER NOT NULL CHECK (relationship_count >= 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  FOREIGN KEY (project_id, scan_job_id) REFERENCES scan_jobs(project_id, id)
) STRICT;

CREATE INDEX snapshots_project_time ON snapshots(project_id, captured_at DESC, id DESC);
CREATE INDEX scan_jobs_project_time ON scan_jobs(project_id, created_at DESC);
CREATE INDEX scan_jobs_state_time ON scan_jobs(state, created_at);

CREATE TRIGGER snapshots_are_immutable
BEFORE UPDATE ON snapshots
BEGIN
  SELECT RAISE(ABORT, 'snapshots are immutable');
END;

CREATE TABLE layouts (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  positions_json TEXT NOT NULL CHECK (json_valid(positions_json)),
  viewport_json TEXT NOT NULL CHECK (json_valid(viewport_json)),
  pinned_ids_json TEXT NOT NULL CHECK (json_valid(pinned_ids_json)),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
) STRICT;

CREATE TABLE suggestion_decisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'accepted', 'dismissed')),
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, fingerprint)
) STRICT;

CREATE TABLE provider_cache (
  provider TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  sanitized_json TEXT NOT NULL CHECK (json_valid(sanitized_json)),
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, cache_key)
) STRICT;

PRAGMA user_version = 1;
