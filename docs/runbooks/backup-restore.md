# Backup and restore

SeedBoard stores projects, immutable snapshots, jobs, layouts, and suggestion decisions in its own SQLite database. It never stores target source bodies or target database rows.

## Backup

1. Stop the API and CLI processes so no writes are in flight.
2. Copy the complete SeedBoard data directory, including the SQLite database and any SQLite `-wal` / `-shm` files that remain. Do not copy only the main database while a process is writing.
3. Store the copy in a location with access controls appropriate for project names, relative paths, and architecture metadata. A backup is not a sanitized export.
4. Record the SeedBoard version and backup time separately from target evidence timestamps.

For a live backup, use SQLite's online backup API; this workspace does not yet expose a backup command. Do not manually delete WAL files.

## Restore rehearsal

1. Stop SeedBoard.
2. Copy the backup into a new, isolated data directory and set `MODERNIZER_DATA_DIR` to that directory.
3. Start SeedBoard and verify local readiness, project listing, snapshot retrieval, layout, and decision state.
4. Run the workspace tests against the restored database copy before adopting it as the active directory.
5. Keep the original data directory until the restored copy has passed these checks.

Schema upgrades are applied by SeedBoard startup migrations. The application currently has a fresh-install migration test; a multi-version production upgrade and rollback rehearsal remains a release limitation. Restoring an older backup discards snapshots, layout, and decisions created after that backup.
