# Local setup and first scan

SeedBoard runs locally and binds its API and dashboard to loopback. Default scans parse bounded files as data; they do not run the target's scripts, import its modules, call its APIs, or open its database.

## Requirements

- Node.js 24.22.2 from `.node-version`.
- pnpm 12.16.1 from the root `packageManager` field.
- Windows 10/11 x64 or arm64, or a current Linux development machine.

## Install and start

From the repository root in PowerShell:

1. Run `node --version` and `pnpm --version`. This project requires Node.js 24.22.2 and pnpm 12.16.1.
2. Install with `pnpm dlx pnpm@12.16.1 install --frozen-lockfile --ignore-scripts`.
3. Run `pnpm dlx pnpm@12.16.1 contracts:check`.
4. Run `pnpm dlx pnpm@12.16.1 typecheck`.
5. Run `pnpm dlx pnpm@12.16.1 test`.
6. Run `pnpm dlx pnpm@12.16.1 build`.
7. Run `pnpm dlx pnpm@12.16.1 docs:check`.
8. Start with `pnpm dlx pnpm@12.16.1 dev`.

The API is at `http://127.0.0.1:4317`; the dashboard is at `http://127.0.0.1:5173`. The Vite development proxy forwards only `/api` to the loopback API. The dashboard obtains its short-lived same-origin session itself. Use `http://127.0.0.1:5173/?demo=1` to view the labeled synthetic fixture without registering a repository.

Stop both local processes with Ctrl+C in the terminal running `pnpm dev`.

## Register a repository and scan

In another PowerShell window from the repository root:

```powershell
pnpm dlx pnpm@12.16.1 --filter @modernizer/cli exec node dist/index.js project register "C:\path\to\your\repository" --name "Optional label"
```

Registration stores the chosen folder as a trusted local root; it does not read its files. Reload the dashboard and choose **Run first scan**. A scan reads eligible metadata within the configured file, byte, depth, and component limits. Unsupported files and incomplete collection remain visible as coverage issues.

To list locally registered projects:

```powershell
pnpm dlx pnpm@12.16.1 --filter @modernizer/cli exec node dist/index.js project list
```

The browser cannot choose or submit a filesystem root. The first version collects Node manifests/npm lockfiles, GitHub workflow YAML, and migration filenames. Provider runs, deployment versions, applied database migration state, and non-Node stacks remain unknown unless an explicit future adapter supplies evidence.

## Local data and backup

To preserve existing installations, SeedBoard continues to use its original local data location: `%LOCALAPPDATA%\Modernizer\modernizer.sqlite` on Windows, `~/Library/Application Support/Modernizer/modernizer.sqlite` on macOS, or `$XDG_DATA_HOME/modernizer/modernizer.sqlite` (otherwise `~/.local/share/modernizer/modernizer.sqlite`) on Linux. The `MODERNIZER_DATA_DIR` setting remains the override name for compatibility. Read [backup and restore](backup-restore.md) before moving or replacing the database.

## Troubleshooting

See [the troubleshooting guide](troubleshooting.md) for startup, scan coverage, storage, browser-session, and export issues.
