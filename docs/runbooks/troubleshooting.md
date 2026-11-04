# Troubleshooting

## Dashboard cannot reach the local service

- Confirm the API is listening at `127.0.0.1:4317` and the dashboard at `127.0.0.1:5173`.
- Restart with `pnpm dev` if either port is already in use; the current defaults are fixed.
- For a browser request rejection, reload the page so the local session cookie and CSRF header can be issued again. The API rejects unexpected hosts, cross-origin requests, and missing session headers.

## No project or snapshot is shown

- Register a folder with the CLI in [local setup](local-setup.md), then reload the dashboard.
- If a project has no saved snapshot, select **Run first scan**.
- If the scan failed, the last published snapshot is retained. Read the safe issue codes from the scan record; the API does not expose filesystem paths in errors.

## Coverage is partial or unsupported

- Confirm the relevant manifest, supported lockfile, workflow YAML, or migration filename is inside the selected root and within configured traversal limits.
- An unsupported language/lockfile or a dynamic workflow expression stays unknown. Do not interpret a missing observation as healthy, deployed, or applied.
- Default discovery excludes environment files, credentials, common build folders, and `node_modules` directories. Dependency packages from a supported lockfile can still appear as package records.

## Documentation is missing

- The appendix keeps one row per component and names unresolved references or review gaps.
- Registry links in SeedBoard's own machine-readable lockfile inventory are package lookup pages, not individually reviewed vendor guides.
- Add and review an internal guide for the component; keep unknown operations and credentials explicitly undocumented.

## Export or restore problems

- Exports strip URL credentials, queries, and fragments; review the resulting Markdown before sharing it.
- For database lock, backup, or restore issues, stop SeedBoard and follow [backup and restore](backup-restore.md). Preserve the original directory during recovery.
