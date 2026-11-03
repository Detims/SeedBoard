# Service and technology documentation

Modernizer's exact resolved npm package versions are recorded in the [dependency inventory](dependency-inventory.json). That inventory also includes registry references and license metadata when supplied by package metadata. The direct services and technologies below link to their official documentation.

| Service or technology | Version / role | Documentation |
| --- | --- | --- |
| Node.js | Supported local runtime: 24.22.2 or 26.13+ | [Node.js releases](https://nodejs.org/en/about/previous-releases) |
| Node.js `node:sqlite` | Built-in local storage driver | [SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) |
| pnpm | Workspace package manager, 12.16.1 | [pnpm documentation](https://pnpm.io/) |
| TypeScript | Shared source language | [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/) |
| Fastify | Local HTTP API | [Fastify documentation](https://fastify.dev/docs/latest/) |
| React and React DOM | Browser interface | [React](https://react.dev/learn), [React DOM](https://react.dev/reference/react-dom) |
| React Flow | Interactive architecture map | [React Flow](https://reactflow.dev/learn) |
| Lucide React | Interface icons | [Lucide React](https://lucide.dev/guide/packages/lucide-react) |
| Vite and React plugin | Local browser development and build | [Vite](https://vite.dev/guide/), [React plugin](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react) |
| Vitest | Unit and integration checks | [Vitest](https://vitest.dev/guide/) |
| Prettier | Source formatting | [Prettier](https://prettier.io/docs/) |
| Ajv and ajv-formats | Snapshot schema and format validation | [Ajv](https://ajv.js.org/guide/), [ajv-formats](https://ajv.js.org/packages/ajv-formats.html) |
| YAML | Workflow and contract parsing | [YAML](https://eemeli.org/yaml/) |
| GitHub Actions | Modernizer CI workflow | [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) |
| actions/checkout | CI source checkout, pinned to v7.0.1 | [Release notes](https://github.com/actions/checkout/releases/tag/v7.0.1) |
| actions/setup-node | CI runtime setup, pinned to v7.1.0 | [Release notes](https://github.com/actions/setup-node/releases/tag/v7.1.0) |

The package inventory is exhaustive for packages resolved by the current lockfile. A registry link does not mean that a vendor's version-specific guide or license terms have been individually reviewed. Target application services receive documentation links when a curated official reference is available; unmapped services remain visible as gaps in the dashboard appendix.
