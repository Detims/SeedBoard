# Modernizer

An evidence-backed dashboard for understanding an application's architecture, dependencies, environments, databases, and delivery pipeline before modernization work.

**Implementation status: T0–T7 MVP implemented.** The local workspace now includes bounded static discovery, SQLite-backed immutable snapshots, evidence-gated suggestions, sanitized documentation exports, a connected React dashboard, and Windows/Linux CI gates. GitHub live-run lookups, deployed-version checks, live database inspection, and other language ecosystems remain deferred.

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
| [Dependency inventory](docs/dependency-inventory.json) | Generated exact third-party package inventory from the lockfile |
| [T0 handoff](docs/handoffs/T0.md) | Foundation implementation and verification record |
| [T1–T7 handoffs](docs/handoffs/) | Checkpoint results, exact checks, and remaining limits |

## Intended first release

A single-user local application: register a local repository through the CLI, collect bounded metadata without executing project code, and inspect immutable snapshots in a browser. The graph supports map navigation, search, filters, selection, and stored layouts; inventory, suggestions, CI/environment, data/migration, documentation, comparison, and export views use validated snapshots. Collectors currently support Node manifests, npm lockfiles, GitHub workflow declarations, and migration-file inventory. Unknown stacks remain visible with coverage states rather than fabricated versions or health.

The MVP work packages T0–T7 are complete. The next package, T8 live-provider enrichment, is deferred and needs separate scope and permissions.

## First slice commands

From PowerShell: `pnpm install --frozen-lockfile`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm docs:check`, and `pnpm dev`. Open `http://127.0.0.1:5173`; register a project with the CLI command in the local setup guide. Use `?demo=1` for the explicitly labeled synthetic fixture. The API binds to `127.0.0.1:4317`.
