# SeedBoard

SeedBoard is a local-first dashboard for reviewing application architecture, dependencies, environments, databases, migrations, and delivery pipelines before modernization work.

## Capabilities

A single-user local application: register a local repository through the CLI, collect bounded metadata without executing project code, and inspect immutable snapshots in a browser. The graph supports map navigation, search, filters, selection, and stored layouts; inventory, suggestions, CI/environment, data/migration, documentation, comparison, and export views use validated snapshots. Collectors currently support Node manifests, npm lockfiles, GitHub workflow declarations, and migration-file inventory. Git-backed scans record the commit at scan start; the comparison view can show tracked file changes since that commit and restore selected paths after an explicit confirmation. Unknown stacks remain visible with coverage states rather than fabricated versions or health.

The Coverage & risks view summarizes declared test suites, explicit test/deployment mappings, and dependency concentration. It keeps measured test coverage and live CI/deployment health unknown unless those data sources are available.

Scans collect bounded file metadata only. They do not execute target code, apply migrations, contact providers, or verify deployment health. Git-backed scan history reads local Git metadata; restoring a selected tracked file overwrites its current working-tree contents with the version at the scan commit. SeedBoard does not create a backup of overwritten file contents; restoring staged changes is blocked, and untracked files are not included. Unsupported or missing evidence stays visible as unknown or incomplete.

Package freshness and runtime lifecycle checks are a separate, user-initiated action in the component inventory. After explicit consent, SeedBoard sends resolved package names to the public npm registry and checks Node.js runtime lifecycle data from endoflife.date; installed versions are compared locally. It does not send project files. These sources do not represent a security vulnerability scan; unknown or unsupported version data remains unknown.

## First slice commands

From PowerShell, run `pnpm install --frozen-lockfile`, then `pnpm dev` and open `http://127.0.0.1:5173`. Register a project with the CLI steps in the [local setup guide](docs/runbooks/local-setup.md). Use `?demo=1` for the labeled synthetic example. The API binds to `127.0.0.1:4317`.

## Project references

- [Service and technology documentation](docs/services.md)
- [Resolved package inventory](docs/dependency-inventory.json)
- [Snapshot schema](contracts/snapshot.schema.json) and [API](contracts/openapi.yaml)
- [Backup and restore](docs/runbooks/backup-restore.md)
- [Troubleshooting](docs/runbooks/troubleshooting.md)
- [Synthetic snapshot fixtures](fixtures/)
