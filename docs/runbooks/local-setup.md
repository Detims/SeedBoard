# Local developer setup

This setup runs the Modernizer API skeleton. Repository discovery, storage, and dashboard screens are delivered in later work packages.

## Requirements

- Node.js 24.22.2 (LTS), selected in the repository's .node-version file.
- pnpm 12.16.1, pinned in package.json through its packageManager field.
- Windows 10/11 x64 or arm64 is the initial target. Other platforms should use the same pinned versions.

The official Node.js release page lists 24.22.2 as LTS. Use the official Windows installer or a Node version manager, then install pnpm 12.16.1 using a supported pnpm installation method. Do not change the global Node or pnpm installation solely for Modernizer if you already use a version manager.

## Install and run

From the repository root in PowerShell, run these commands in order:

1. `node --version`
2. `pnpm --version`
3. `pnpm install --frozen-lockfile`
4. `pnpm contracts:check`
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm build`
8. `pnpm docs:check`
9. `pnpm dev`

The API binds to 127.0.0.1:4317 by default. Open http://127.0.0.1:4317/api/v1/healthz to inspect Modernizer readiness. PORT can select another local port. Stop the API with Ctrl+C. The root test:e2e command intentionally identifies T7 as its owner until the browser application exists.

At this stage, the health response reports only that the Modernizer API process is ready. It says nothing about any assessed application.

## Current data location and backup

T0 has no persistent database or registered repository roots. Do not expect scan history to survive a stop yet. T2 owns the durable data directory, backup and restore procedures, CLI registration, and lifecycle behavior.

## Troubleshooting

- A Node or pnpm version mismatch means the required pinned runtime is not active. Confirm the version manager honors .node-version.
- A frozen install requires the committed pnpm-lock.yaml; regenerate it only when intentionally changing package inputs, then review the diff.
- If port 4317 is already in use, choose a free port with PORT=4318 pnpm dev.
- If the health endpoint responds but a project scan is not available, that is expected before T1/T2 integration.
