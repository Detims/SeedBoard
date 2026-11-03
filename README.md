# Modernizer

Modernizer is a local-first tool for reviewing application architecture, dependencies, environments, databases, migrations, and delivery pipelines before modernization work.

## Capabilities

A single-user local application: register a local repository through the CLI, collect bounded metadata without executing project code, and inspect immutable snapshots in a browser. The graph supports map navigation, search, filters, selection, and stored layouts; inventory, suggestions, CI/environment, data/migration, documentation, comparison, and export views use validated snapshots. Collectors currently support Node manifests, npm lockfiles, GitHub workflow declarations, and migration-file inventory. Unknown stacks remain visible with coverage states rather than fabricated versions or health.

Scans collect bounded file metadata only. They do not execute target code, apply migrations, contact providers, or verify deployment health. Unsupported or missing evidence stays visible as unknown or incomplete.

## First slice commands

From PowerShell, run `pnpm install --frozen-lockfile`, then `pnpm dev` and open `http://127.0.0.1:5173`. Register a project with the CLI steps in the [local setup guide](docs/runbooks/local-setup.md). Use `?demo=1` for the labeled synthetic example. The API binds to `127.0.0.1:4317`.

## Project references

- [Service and technology documentation](docs/services.md)
- [Resolved package inventory](docs/dependency-inventory.json)
- [Snapshot schema](contracts/snapshot.schema.json) and [API](contracts/openapi.yaml)
- [Backup and restore](docs/runbooks/backup-restore.md)
- [Troubleshooting](docs/runbooks/troubleshooting.md)
- [Synthetic snapshot fixtures](fixtures/)
