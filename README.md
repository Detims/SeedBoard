# Modernizer

An evidence-backed dashboard for understanding an application's architecture, dependencies, environments, databases, and delivery pipeline before modernization work.

**Implementation status: T0 foundation in progress.** The blueprints and synthetic fixtures are in place. T0 is adding the pinned workspace, schema-derived contract package, API contract, and loopback API skeleton. Scanning, persistence, providers, and dashboard screens belong to later work packages and are not complete yet.

## Read first

1. [Product requirements](docs/01-product.md): scope and measurable behavior.
2. [Domain glossary](CONTEXT.md): shared language and counting rules.
3. [Architecture](docs/02-architecture.md): boundaries, stack, and scan flow.
4. [Contracts](docs/03-contracts.md): shared data, API, and persistence rules.
5. [Agent work packages](docs/08-agent-work-packages.md): ownership, dependencies, and copyable assignments.

## Blueprint index

| Document | Purpose |
| --- | --- |
| [Agent instructions](AGENTS.md) | Rules all implementation agents must follow |
| [Discovery](docs/04-discovery.md) | Supported inputs, evidence, versions, and provider adapters |
| [Dashboard experience](docs/05-experience.md) | Obsidian-inspired graph and dashboard behavior |
| [Suggestions](docs/06-suggestions.md) | Deterministic feat/chore/refactor/style/fix/docs rules |
| [Documentation appendix](docs/07-documentation-appendix.md) | Official sources and internal documentation requirements |
| [Work packages](docs/08-agent-work-packages.md) | Small, independently reviewable implementation slices |
| [Validation and delivery](docs/09-validation-delivery.md) | Acceptance scenarios, CI gates, packaging, recovery |
| [Security and operations](docs/10-security-operations.md) | Local trust boundary, secrets, retention, and operational defaults |
| [Decisions](docs/11-decisions.md) | Assumptions, deferred capabilities, and change process |
| [Schema](contracts/snapshot.schema.json) | Machine-readable snapshot contract, version 1.0 |
| [Demo snapshot](fixtures/demo.snapshot.json) | Synthetic contract-valid reference input |
| [Empty and partial snapshots](fixtures/) | Synthetic contract cases for the first implementation slices |
| [Service documentation template](docs/templates/service.md) | A page for every core or minor integration |
| [Agent handoff template](docs/templates/agent-handoff.md) | Evidence required from each completed work package |
| [T0 handoff](docs/handoffs/T0.md) | Foundation implementation and verification record |

## Intended first release

A single-user local application: select a local repository through a CLI, collect metadata without executing project code, and inspect an immutable snapshot in a browser. React/TypeScript presents an interactive architecture graph and inventory; a local API and SQLite store snapshots, scan state, graph layouts, and suggestion decisions. Initial analyzers support Node manifests, npm lockfiles, GitHub workflow declarations, and migration-file inventory. Unknown stacks remain visible as unsupported.

The first implementation task is **T0: foundation and contracts**. Follow the dependency order in the work packages. Do not attempt the whole system in one agent run. The full MVP ends at T7; later live provider features are explicitly separate.

## First slice commands

Once the pinned dependencies are installed: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm docs:check`, and `pnpm dev`. The current API skeleton only reports Modernizer process readiness. CLI registration, scanning, history, and UI are not yet implemented.
