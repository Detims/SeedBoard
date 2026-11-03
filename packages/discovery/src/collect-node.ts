import { parseDocument } from "yaml";
import { addComponent, addCoverage, addEvidence, addIssue, addRelationship, stableId, type CollectorSink } from "./shared.js";
import { isSafeRelativePath, type SafeSource } from "./safe-source.js";
import type { DependencyOccurrenceFact, DiscoveryFacts, DiscoveryIssue, WorkflowFact, WorkspaceFact } from "./types.js";
import type { ConfigCollection } from "./collect-config.js";

type UnknownRecord = Record<string, unknown>;
type Manifest = {
  path: string;
  name: string;
  scripts: string[];
  dependencies: Map<string, { range: string; evidenceId: string }>;
  evidenceId: string;
  componentId: string;
  nodeRange: string | null;
  formatterConfigPresent: boolean;
  formatterDependencyPresent: boolean;
};
type LockPackage = {
  locator: string;
  name: string;
  version: string;
  dependencies: string[];
  evidenceId: string;
  componentId: string;
};

const packageNamePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const versionCharactersPattern = /^[A-Za-z0-9*^~<>=|+\-. ]+$/;
const frontendLibraries = new Set(["react", "react-dom", "vue", "svelte", "solid-js", "@angular/core"]);
const backendLibraries = new Set(["fastify", "express", "koa", "hono", "@nestjs/core"]);
const databaseDrivers = new Set([
  "pg",
  "mysql2",
  "sqlite3",
  "better-sqlite3",
  "@libsql/client",
  "mongoose",
  "mongodb",
  "postgres",
]);
const testLibraries = new Set(["vitest", "jest", "mocha", "@playwright/test", "playwright"]);
const formatters = new Set(["prettier", "biome", "@biomejs/biome", "eslint"]);
const formatterConfigNames = new Set([
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "biome.json",
  "biome.jsonc",
  ".eslintrc",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
]);

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringRecord(value: unknown): UnknownRecord {
  return record(value) ?? {};
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function workspaceArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  const workspaces = record(value)?.packages;
  return Array.isArray(workspaces)
    ? workspaces.filter((item): item is string => typeof item === "string")
    : [];
}

function globExpression(pattern: string): RegExp | null {
  if (!isSafeRelativePath(pattern.replaceAll("*", "x"))) return null;
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

function matchesPatterns(path: string, patterns: string[]): boolean {
  let included = false;
  for (const original of patterns) {
    const excluded = original.startsWith("!");
    const pattern = excluded ? original.slice(1) : original;
    const matcher = globExpression(pattern);
    if (matcher?.test(path)) included = !excluded;
  }
  return included;
}

function sanitisePackageName(value: string): string | null {
  return value.length <= 214 && packageNamePattern.test(value) ? value : null;
}

function sanitiseVersion(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    return "unsupported-specifier";
  }
  if (value.startsWith("workspace:")) return `workspace:${value.slice(10).replace(/[^\w*.^~<>=|+-]/g, "") || "*"}`;
  if (value.startsWith("file:") || value.startsWith("link:")) return "local-workspace-specifier";
  if (versionCharactersPattern.test(value) && !value.includes("..")) return value.trim() || "unsupported-specifier";
  return "non-registry-specifier";
}

function inferLayer(nameSet: Set<string>): { kind: "frontend" | "backend" | "package"; layer: "frontend" | "backend" | "shared" }[] {
  const results: { kind: "frontend" | "backend" | "package"; layer: "frontend" | "backend" | "shared" }[] = [];
  if ([...frontendLibraries].some((name) => nameSet.has(name))) results.push({ kind: "frontend", layer: "frontend" });
  if ([...backendLibraries].some((name) => nameSet.has(name))) results.push({ kind: "backend", layer: "backend" });
  if (results.length === 0) results.push({ kind: "package", layer: "shared" });
  return results;
}

function workspaceComponent(
  sink: CollectorSink,
  manifestPath: string,
  name: string,
  kind: "frontend" | "backend" | "package",
  layer: "frontend" | "backend" | "shared",
  evidenceId: string,
  version: string | null,
): string {
  const id = stableId("component", sink.projectId, kind, manifestPath, name);
  const existing = sink.components.find((component) => component.id === id);
  if (existing) return existing.id;
  addComponent(
    sink,
    {
      id,
      kind,
      layer,
      name,
      locator: manifestPath,
      environmentIds: [],
      versions: version
        ? [
            {
              facet: "declared",
              value: sanitiseVersion(version),
              environmentId: null,
              observedAt: sink.capturedAt,
              evidenceIds: [evidenceId],
            },
          ]
        : [],
      observations: [
        {
          dimension: "configuration",
          state: "configured",
          environmentId: null,
          observedAt: sink.capturedAt,
          confidence: "medium",
          evidenceIds: [evidenceId],
        },
      ],
      evidenceIds: [evidenceId],
    },
    "node-manifests",
  );
  return id;
}

function nearestWorkspace(path: string, manifests: Manifest[]): Manifest | null {
  const matches = manifests
    .filter((manifest) => manifest.path === "." || path === manifest.path || path.startsWith(`${manifest.path}/`))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0] ?? null;
}

function lockPackageName(lockPath: string, explicitName: unknown): string | null {
  if (typeof explicitName === "string") return sanitisePackageName(explicitName);
  const at = lockPath.lastIndexOf("node_modules/");
  if (at < 0) return null;
  const suffix = lockPath.slice(at + "node_modules/".length).split("/");
  const name = suffix[0]?.startsWith("@") ? `${suffix[0]}/${suffix[1] ?? ""}` : suffix[0];
  return name ? sanitisePackageName(name) : null;
}

function nodeModulesPath(owner: string, packageName: string): string {
  const base = owner === "." ? "" : `${owner}/`;
  return `${base}node_modules/${packageName}`;
}

export async function collectNodeManifests(
  source: SafeSource,
  sink: CollectorSink,
  facts: DiscoveryFacts,
  config: ConfigCollection,
  selectedCollectors: ReadonlySet<string> | null,
): Promise<{ manifests: Manifest[]; dependencyDeclarations: DependencyOccurrenceFact[]; supported: boolean }> {
  if (selectedCollectors && !selectedCollectors.has("node-manifests")) {
    addCoverage(sink, "node-manifests", "not_configured", "Node manifests", "Disabled by project configuration.");
    return { manifests: [], dependencyDeclarations: [], supported: false };
  }
  const allPaths = source.paths().filter((path) => !isIgnoredByConfig(path, config.ignorePatterns));
  const rootManifest = allPaths.includes("package.json") ? "package.json" : null;
  let workspacePatterns: string[] = [];

  if (rootManifest) {
    try {
      const rootInput = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await source.read(rootManifest))));
      if (rootInput) workspacePatterns = workspaceArray(rootInput.workspaces);
    } catch {
      // The regular manifest collector below records the bounded parse failure.
    }
  }

  let workspaceManifest: string[] = [];
  if (source.has("pnpm-workspace.yaml") && !isIgnoredByConfig("pnpm-workspace.yaml", config.ignorePatterns)) {
    try {
      const document = parseDocument(new TextDecoder("utf-8", { fatal: true }).decode(await source.read("pnpm-workspace.yaml")), { uniqueKeys: true });
      if (document.errors.length === 0) workspacePatterns.push(...workspaceArray(document.toJS({ maxAliasCount: 50 }).packages));
      else addIssue(sink, "node-manifests", "parse_failed", "pnpm-workspace.yaml", "Workspace declaration is malformed.");
    } catch {
      addIssue(sink, "node-manifests", "parse_failed", "pnpm-workspace.yaml", "Workspace declaration is malformed or exceeds parser limits.");
    }
  }
  workspacePatterns = [...new Set(workspacePatterns)];
  if (rootManifest && workspacePatterns.length > 0) {
    workspaceManifest = allPaths
      .filter((path) => path.endsWith("/package.json"))
      .map((path) => path.slice(0, -"/package.json".length))
      .filter((path) => matchesPatterns(path, workspacePatterns))
      .map((path) => `${path}/package.json`);
  }

  const manifestPaths = [...new Set([...(rootManifest ? [rootManifest] : []), ...workspaceManifest])].sort();
  const manifests: Manifest[] = [];
  const dependencyDeclarations: DependencyOccurrenceFact[] = [];
  const workspacesByName = new Map<string, string>();
  const configEvidenceByPath = new Map<string, string>();
  let parseFailed = false;

  for (const path of manifestPaths) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await source.read(path)));
    } catch {
      parseFailed = true;
      addIssue(sink, "node-manifests", "parse_failed", path, "Package manifest is malformed or exceeds configured limits.");
      continue;
    }
    const input = record(parsed);
    if (!input) {
      parseFailed = true;
      addIssue(sink, "node-manifests", "parse_failed", path, "Package manifest must be a JSON object.");
      continue;
    }

    const rootPath = path === "package.json" ? "." : path.slice(0, -"/package.json".length);
    const rawName = text(input.name);
    const name = rawName && sanitisePackageName(rawName) ? rawName : rootPath === "." ? "root project" : rootPath;
    const dependencies = {
      ...stringRecord(input.dependencies),
      ...stringRecord(input.devDependencies),
      ...stringRecord(input.optionalDependencies),
      ...stringRecord(input.peerDependencies),
    };
    const dependencyNames = Object.keys(dependencies).sort();
    const validDependencyNames = dependencyNames.filter((dependencyName) => sanitisePackageName(dependencyName));
    const names = new Set(validDependencyNames);
    const roles = inferLayer(names);
    const scripts = Object.keys(stringRecord(input.scripts)).filter((script) => /^[A-Za-z0-9:_-]{1,100}$/.test(script)).sort();
    const evidenceId = addEvidence(sink, "file", path, null, "Package manifest metadata; script bodies are never stored.", 1);
    configEvidenceByPath.set(path, evidenceId);
    const version = text(input.version);
    const workspaceComponentIds = roles.map(({ kind, layer }) =>
      workspaceComponent(sink, path, name, kind, layer, evidenceId, version),
    );
    const componentId = workspaceComponentIds[0] ?? stableId("component", sink.projectId, "package", path, name);

    const nodeRange = text(record(input.engines)?.node);
    if (nodeRange) {
      const runtimeId = stableId("component", sink.projectId, "runtime", path, "node");
      addComponent(sink, {
        id: runtimeId,
        kind: "runtime",
        layer: "shared",
        name: `Node.js runtime declared by ${name}`,
        locator: path,
        environmentIds: [],
        versions: [{ facet: "declared", value: sanitiseVersion(nodeRange), environmentId: null, observedAt: sink.capturedAt, evidenceIds: [evidenceId] }],
        observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "high", evidenceIds: [evidenceId] }],
        evidenceIds: [evidenceId],
      }, "node-manifests");
    }

    if (scripts.some((script) => script === "test" || script.startsWith("test:")) || [...names].some((dependency) => testLibraries.has(dependency))) {
      const testId = stableId("component", sink.projectId, "test_suite", path, name);
      addComponent(sink, {
        id: testId,
        kind: "test_suite",
        layer: "testing",
        name: `${name} test suite`,
        locator: path,
        environmentIds: [],
        versions: [],
        observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "high", evidenceIds: [evidenceId] }],
        evidenceIds: [evidenceId],
      }, "node-manifests");
    }

    for (const driver of [...names].filter((dependency) => databaseDrivers.has(dependency))) {
      addComponent(sink, {
        id: stableId("component", sink.projectId, "database", path, driver),
        kind: "database",
        layer: "data",
        name: `Database driver inferred from ${driver}`,
        locator: path,
        environmentIds: [],
        versions: [],
        observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "low", evidenceIds: [evidenceId] }],
        evidenceIds: [evidenceId],
      }, "node-manifests");
    }

    const dependencyMap = new Map<string, { range: string; evidenceId: string }>();
    for (const dependencyName of validDependencyNames) {
      dependencyMap.set(dependencyName, {
        range: sanitiseVersion(dependencies[dependencyName]),
        evidenceId,
      });
    }
    const displayWorkspace = rootPath;
    const formatterConfigPresent = allPaths.some((candidate) => formatterConfigNames.has(candidate.split("/").at(-1)!.toLowerCase()));
    const formatterDependencyPresent = [...names].some((dependencyName) => formatters.has(dependencyName));
    const workspaceFact: WorkspaceFact = {
      path: displayWorkspace,
      componentId,
      manifestEvidenceId: evidenceId,
      scripts,
      formatterConfigPresent,
      formatterDependencyPresent,
    };
    facts.workspaces.push(workspaceFact);
    const manifest: Manifest = {
      path: displayWorkspace,
      name,
      scripts,
      dependencies: dependencyMap,
      evidenceId,
      componentId,
      nodeRange,
      formatterConfigPresent,
      formatterDependencyPresent,
    };
    manifests.push(manifest);
    if (rawName && sanitisePackageName(rawName)) workspacesByName.set(rawName, componentId);
  }

  if (manifestPaths.length === 0) {
    addCoverage(sink, "node-manifests", "unsupported", "Node manifests", "No supported package.json manifest was found.");
    addIssue(sink, "node-manifests", "unsupported_input", null, "No supported Node project manifest was found.");
  } else {
    addCoverage(sink, "node-manifests", parseFailed ? "failed" : "supported", "Node manifests and declared dependencies", parseFailed ? "One or more package manifests could not be parsed; remaining results are partial." : "Parsed package manifests and selected metadata only.");
  }

  const workspaceNames = [...workspacesByName.entries()];
  const declaredNames = new Set<string>();
  for (const manifest of manifests) {
    for (const [dependencyName, declaration] of manifest.dependencies) {
      declaredNames.add(dependencyName);
      const otherWorkspaceId = workspacesByName.get(dependencyName);
      if (otherWorkspaceId && (declaration.range === "workspace:*" || declaration.range.startsWith("workspace:"))) {
        addRelationship(sink, {
          id: stableId("relationship", sink.projectId, manifest.componentId, otherWorkspaceId, "depends_on"),
          fromId: manifest.componentId,
          toId: otherWorkspaceId,
          type: "depends_on",
          environmentIds: [],
          confidence: "high",
          evidenceIds: [declaration.evidenceId],
        }, "node-manifests");
      }
    }
  }
  // Retain declared packages as separate records until the lock collector links exact resolutions.
  for (const manifest of manifests) {
    for (const [dependencyName, declaration] of manifest.dependencies) {
      if (workspacesByName.has(dependencyName) && declaration.range.startsWith("workspace:")) continue;
      dependencyDeclarations.push({
        name: dependencyName,
        version: declaration.range,
        declaredRange: declaration.range,
        resolved: false,
        workspacePath: manifest.path,
        componentId: "",
        manifestEvidenceId: declaration.evidenceId,
        lockEvidenceId: null,
        direct: true,
      });
    }
  }
  void workspaceNames;
  void declaredNames;
  void configEvidenceByPath;
  return { manifests, dependencyDeclarations, supported: manifestPaths.length > 0 };
}

function isIgnoredByConfig(path: string, patterns: string[]): boolean {
  let ignored = false;
  for (const original of patterns) {
    const excluded = original.startsWith("!");
    const pattern = excluded ? original.slice(1) : original;
    const matcher = globExpression(pattern);
    if (matcher?.test(path)) ignored = !excluded;
  }
  return ignored;
}

export async function collectNpmLock(
  source: SafeSource,
  sink: CollectorSink,
  facts: DiscoveryFacts,
  config: ConfigCollection,
  manifestResult: Awaited<ReturnType<typeof collectNodeManifests>>,
  selectedCollectors: ReadonlySet<string> | null,
): Promise<void> {
  if (selectedCollectors && !selectedCollectors.has("npm-lock")) {
    addCoverage(sink, "npm-lock", "not_configured", "npm lockfile", "Disabled by project configuration.");
    return;
  }
  const lockPath = source.has("package-lock.json") && !isIgnoredByConfig("package-lock.json", config.ignorePatterns) ? "package-lock.json" : null;
  if (!lockPath) {
    const alternate = source.paths().find((path) => ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].includes(path));
    if (alternate) {
      addCoverage(sink, "npm-lock", "unsupported", alternate, "A non-npm lockfile was found; exact package resolutions were not interpreted.");
      addIssue(sink, "npm-lock", "unsupported_input", alternate, "This lockfile format is not supported in the current release.");
    } else {
      addCoverage(sink, "npm-lock", manifestResult.supported ? "not_configured" : "unsupported", "package-lock.json", manifestResult.supported ? "No npm lockfile was found; resolved package versions remain unknown." : "No Node project was found to provide an npm lockfile.");
    }
    await createUnresolvedDeclarations(sink, facts, manifestResult.dependencyDeclarations);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await source.read(lockPath)));
  } catch {
    addCoverage(sink, "npm-lock", "failed", lockPath, "npm lockfile is malformed or exceeds configured limits.");
    addIssue(sink, "npm-lock", "parse_failed", lockPath, "npm lockfile could not be safely parsed.");
    await createUnresolvedDeclarations(sink, facts, manifestResult.dependencyDeclarations);
    return;
  }
  const lock = record(parsed);
  if (!lock || ![2, 3].includes(Number(lock.lockfileVersion)) || !record(lock.packages)) {
    addCoverage(sink, "npm-lock", "unsupported", lockPath, "Only npm lockfile versions 2 and 3 with a packages map are supported.");
    addIssue(sink, "npm-lock", "unsupported_input", lockPath, "npm lockfile must use version 2 or 3 with package records.");
    await createUnresolvedDeclarations(sink, facts, manifestResult.dependencyDeclarations);
    return;
  }

  const lockEvidenceId = addEvidence(sink, "file", lockPath, null, "npm lockfile package metadata; scripts are never executed.", 1);
  const entries = record(lock.packages)!;
  const packageRecords = new Map<string, LockPackage>();
  const workspaceComponents = new Map<string, string>(
    manifestResult.manifests.map((manifest) => [manifest.name, manifest.componentId]),
  );
  const pathToNameVersion = new Map<string, { name: string; version: string }>();
  let partial = false;

  for (const [locator, rawEntry] of Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (locator === "" || !locator.includes("node_modules/") || !isSafeRelativePath(locator)) continue;
    const entry = record(rawEntry);
    if (!entry || entry.link === true) continue;
    const name = lockPackageName(locator, entry.name);
    const version = text(entry.version);
    if (!name || !version) {
      partial = true;
      addIssue(sink, "npm-lock", "unsupported_input", lockPath, "A lock entry lacked a safe package name or version and was skipped.");
      continue;
    }
    const safeVersion = sanitiseVersion(version);
    if (safeVersion === "unsupported-specifier" || safeVersion === "non-registry-specifier" || safeVersion.includes(" ")) {
      partial = true;
      addIssue(sink, "npm-lock", "unsupported_input", lockPath, "A lock entry did not contain a safe semver resolution and was skipped.");
      continue;
    }
    const componentId = stableId("component", sink.projectId, "package", locator, name, version);
    const dependencies = Object.keys(stringRecord(entry.dependencies)).filter((dependency) => sanitisePackageName(dependency)).sort();
    addComponent(sink, {
      id: componentId,
      kind: "package",
      layer: "shared",
      name: `${name}@${version}`,
      locator,
      environmentIds: [],
      versions: [{ facet: "resolved", value: version, environmentId: null, observedAt: sink.capturedAt, evidenceIds: [lockEvidenceId] }],
      observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "high", evidenceIds: [lockEvidenceId] }],
      evidenceIds: [lockEvidenceId],
    }, "npm-lock");
    packageRecords.set(locator, { locator, name, version, dependencies, evidenceId: lockEvidenceId, componentId });
    pathToNameVersion.set(locator, { name, version });
  }

  for (const manifest of manifestResult.manifests) {
    for (const [dependencyName, declaration] of manifest.dependencies) {
      if (workspaceComponents.has(dependencyName) && declaration.range.startsWith("workspace:")) continue;
      const resolvedLocator = resolveInstalledPackage(manifest.path, dependencyName, packageRecords);
      if (!resolvedLocator) {
        partial = true;
        const virtualLocator = nodeModulesPath(manifest.path, dependencyName);
        const componentId = stableId("component", sink.projectId, "package", manifest.path, dependencyName, declaration.range);
        const existing = sink.components.find((component) => component.id === componentId);
        if (!existing) {
          addComponent(sink, {
            id: componentId,
            kind: "package",
            layer: "shared",
            name: dependencyName,
            locator: virtualLocator,
            environmentIds: [],
            versions: [{ facet: "declared", value: declaration.range, environmentId: null, observedAt: sink.capturedAt, evidenceIds: [declaration.evidenceId] }],
            observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "medium", evidenceIds: [declaration.evidenceId] }],
            evidenceIds: [declaration.evidenceId],
          }, "npm-lock");
        }
        addRelationship(sink, { id: stableId("relationship", sink.projectId, manifest.componentId, componentId, "depends_on"), fromId: manifest.componentId, toId: componentId, type: "depends_on", environmentIds: [], confidence: "medium", evidenceIds: [declaration.evidenceId] }, "npm-lock");
        facts.dependencies.push({ name: dependencyName, version: declaration.range, declaredRange: declaration.range, resolved: false, workspacePath: manifest.path, componentId, manifestEvidenceId: declaration.evidenceId, lockEvidenceId: null, direct: true });
        continue;
      }

      const target = packageRecords.get(resolvedLocator)!;
      const targetComponent = sink.components.find((component) => component.id === target.componentId);
      if (targetComponent && !targetComponent.versions.some((version) => version.facet === "declared" && version.value === declaration.range && version.evidenceIds.includes(declaration.evidenceId))) {
        targetComponent.versions.push({ facet: "declared", value: declaration.range, environmentId: null, observedAt: sink.capturedAt, evidenceIds: [declaration.evidenceId] });
        targetComponent.evidenceIds = [...new Set([...targetComponent.evidenceIds, declaration.evidenceId])].sort();
      }
      // Preserve the declared range on the same workspace-scoped edge fact, not as an observed deployed version.
      addRelationship(sink, { id: stableId("relationship", sink.projectId, manifest.componentId, target.componentId, "depends_on"), fromId: manifest.componentId, toId: target.componentId, type: "depends_on", environmentIds: [], confidence: "high", evidenceIds: [declaration.evidenceId, target.evidenceId] }, "npm-lock");
      facts.dependencies.push({ name: dependencyName, version: target.version, declaredRange: declaration.range, resolved: true, workspacePath: manifest.path, componentId: target.componentId, manifestEvidenceId: declaration.evidenceId, lockEvidenceId: target.evidenceId, direct: true });
    }
  }

  for (const parent of packageRecords.values()) {
    for (const dependencyName of parent.dependencies) {
      const childLocator = resolvePackageFromLock(parent.locator, dependencyName, packageRecords);
      if (!childLocator) {
        partial = true;
        continue;
      }
      const child = packageRecords.get(childLocator)!;
      addRelationship(sink, { id: stableId("relationship", sink.projectId, parent.componentId, child.componentId, "depends_on"), fromId: parent.componentId, toId: child.componentId, type: "depends_on", environmentIds: [], confidence: "high", evidenceIds: [parent.evidenceId, child.evidenceId] }, "npm-lock");
      const owner = nearestWorkspace(parent.locator, manifestResult.manifests);
      facts.dependencies.push({ name: child.name, version: child.version, declaredRange: null, resolved: true, workspacePath: owner?.path ?? ".", componentId: child.componentId, manifestEvidenceId: parent.evidenceId, lockEvidenceId: child.evidenceId, direct: false });
    }
  }

  void config;
  void pathToNameVersion;
  addCoverage(sink, "npm-lock", partial ? "failed" : "supported", lockPath, partial ? "Some dependency resolutions were missing or unsupported; resolved package records are partial." : `Parsed npm lockfile version ${lock.lockfileVersion} and resolved package metadata.`);
}

async function createUnresolvedDeclarations(
  sink: CollectorSink,
  facts: DiscoveryFacts,
  declarations: DependencyOccurrenceFact[],
): Promise<void> {
  for (const declaration of declarations) {
    const componentId = stableId("component", sink.projectId, "package", declaration.workspacePath, declaration.name, declaration.version);
    if (!sink.components.some((component) => component.id === componentId)) {
      addComponent(sink, {
        id: componentId,
        kind: "package",
        layer: "shared",
        name: declaration.name,
        locator: nodeModulesPath(declaration.workspacePath, declaration.name),
        environmentIds: [],
        versions: [{ facet: "declared", value: declaration.version, environmentId: null, observedAt: sink.capturedAt, evidenceIds: [declaration.manifestEvidenceId] }],
        observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "medium", evidenceIds: [declaration.manifestEvidenceId] }],
        evidenceIds: [declaration.manifestEvidenceId],
      }, "npm-lock");
    }
    const workspace = facts.workspaces.find((item) => item.path === declaration.workspacePath);
    if (workspace) addRelationship(sink, { id: stableId("relationship", sink.projectId, workspace.componentId, componentId, "depends_on"), fromId: workspace.componentId, toId: componentId, type: "depends_on", environmentIds: [], confidence: "medium", evidenceIds: [declaration.manifestEvidenceId] }, "node-manifests");
    facts.dependencies.push({ ...declaration, componentId });
  }
}

function resolveInstalledPackage(
  workspacePath: string,
  dependencyName: string,
  records: Map<string, LockPackage>,
): string | null {
  const candidates = [nodeModulesPath(workspacePath, dependencyName), nodeModulesPath(".", dependencyName)];
  return candidates.find((candidate) => records.has(candidate)) ?? null;
}

function resolvePackageFromLock(
  parentLocator: string,
  dependencyName: string,
  records: Map<string, LockPackage>,
): string | null {
  let directory = parentLocator;
  const candidates: string[] = [];
  while (directory.length > 0) {
    candidates.push(`${directory}/node_modules/${dependencyName}`);
    const slash = directory.lastIndexOf("/");
    if (slash < 0) directory = "";
    else directory = directory.slice(0, slash);
  }
  candidates.push(nodeModulesPath(".", dependencyName));
  return candidates.find((candidate) => records.has(candidate)) ?? null;
}

export async function collectGitHubActions(
  source: SafeSource,
  sink: CollectorSink,
  facts: DiscoveryFacts,
  selectedCollectors: ReadonlySet<string> | null,
): Promise<void> {
  const collector = "github-actions" as const;
  if (selectedCollectors && !selectedCollectors.has(collector)) {
    addCoverage(sink, collector, "not_configured", ".github/workflows", "Disabled by project configuration.");
    return;
  }
  const paths = source.paths().filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) && !isIgnoredByConfig(path, config.ignorePatterns));
  if (paths.length === 0) {
    addCoverage(sink, collector, "not_configured", ".github/workflows", "No GitHub Actions workflow files were found.");
    return;
  }

  let anyFailed = false;
  for (const path of paths) {
    const evidenceId = addEvidence(sink, "file", path, null, "GitHub Actions workflow metadata; expressions and commands are not evaluated.", 1);
    const pipelineId = stableId("component", sink.projectId, "pipeline", path);
    addComponent(sink, {
      id: pipelineId,
      kind: "pipeline",
      layer: "delivery",
      name: path.split("/").at(-1)!,
      locator: path,
      environmentIds: [],
      versions: [],
      observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "high", evidenceIds: [evidenceId] }],
      evidenceIds: [evidenceId],
    }, collector);

    let sourceText: string;
    let parsed: UnknownRecord | null;
    let parseStatus: WorkflowFact["parseStatus"] = "complete";
    try {
      const bytes = await source.read(path);
      sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const document = parseDocument(sourceText, { uniqueKeys: true });
      if (document.errors.length > 0) throw new Error("syntax");
      parsed = record(document.toJS({ maxAliasCount: 50 }));
      if (!parsed || !isBoundedWorkflow(parsed, 0, { count: 0 })) throw new Error("limits");
    } catch {
      anyFailed = true;
      parseStatus = "failed";
      addIssue(sink, collector, "parse_failed", path, "Workflow YAML is malformed or exceeds parser limits.");
      facts.workflows.push({ path, pipelineComponentId: pipelineId, workflowEvidenceId: evidenceId, parseStatus, hasDynamicNeeds: false, jobs: [], hasLiteralTestGate: false, ambiguityReasons: ["Workflow could not be fully parsed."] });
      continue;
    }

    const jobsInput = record(parsed.jobs);
    if (!jobsInput) {
      anyFailed = true;
      addIssue(sink, collector, "parse_failed", path, "Workflow has no jobs mapping.");
      facts.workflows.push({ path, pipelineComponentId: pipelineId, workflowEvidenceId: evidenceId, parseStatus: "failed", hasDynamicNeeds: false, jobs: [], hasLiteralTestGate: false, ambiguityReasons: ["Workflow has no jobs mapping."] });
      continue;
    }
    const validJobs = Object.entries(jobsInput).filter(([id, job]) => /^[A-Za-z0-9_-]{1,100}$/.test(id) && record(job));
    const invalidJobs = validJobs.length !== Object.keys(jobsInput).length;
    const ambiguityReasons: string[] = [];
    let hasDynamicNeeds = false;
    if (invalidJobs) {
      parseStatus = "partial";
      anyFailed = true;
      ambiguityReasons.push("One or more job entries had an unsupported shape.");
    }
    const allScriptNames = new Set(facts.workspaces.flatMap((workspace) => workspace.scripts));
    const jobs: WorkflowFact["jobs"] = [];
    const jobIds = new Set(validJobs.map(([id]) => id));

    for (const [id, rawJob] of validJobs) {
      const job = record(rawJob)!;
      const rawNeeds = job.needs;
      const needsValues = rawNeeds === undefined ? [] : Array.isArray(rawNeeds) ? rawNeeds : [rawNeeds];
      const dynamic = needsValues.some((value) => typeof value !== "string" || value.includes("${{"));
      if (dynamic) {
        hasDynamicNeeds = true;
        parseStatus = "partial";
        ambiguityReasons.push("Job prerequisites contain expressions or non-literal values.");
      }
      const literalNeeds = needsValues.filter((value): value is string => typeof value === "string" && !value.includes("${{"));
      const missingNeeds = dynamic ? [] : literalNeeds.filter((value) => !jobIds.has(value));
      const needs = literalNeeds.filter((value) => jobIds.has(value));
      if (missingNeeds.length > 0) {
        anyFailed = true;
        parseStatus = "partial";
        ambiguityReasons.push("A literal job prerequisite did not match a declared job ID.");
        addIssue(sink, collector, "unsupported_input", path, "A workflow job references a missing literal prerequisite.");
      }

      const runScripts = new Set<string>();
      const steps = Array.isArray(job.steps) ? job.steps : [];
      const labels: string[] = [];
      let hasEnvironment = typeof job.environment === "string";
      if (record(job.environment) && typeof record(job.environment)!.name === "string") hasEnvironment = true;
      if (typeof job.name === "string") labels.push(job.name);
      for (const rawStep of steps) {
        const step = record(rawStep);
        if (!step) continue;
        if (typeof step.name === "string") labels.push(step.name);
        if (typeof step.uses === "string") labels.push(step.uses);
        if (typeof step.run === "string") {
          for (const script of extractScriptNames(step.run, allScriptNames)) runScripts.add(script);
        }
      }
      const deploysTarget = hasEnvironment || labels.some((label) => /\bdeploy(?:ment)?\b/i.test(label)) || labels.some((label) => /^(?:actions\/deploy-pages|cloudflare\/wrangler-action|peaceiris\/actions-gh-pages)@/.test(label));
      const isTestGate = [...runScripts].some((script) => script === "test" || script.startsWith("test:"));
      const jobComponentId = stableId("component", sink.projectId, "pipeline-job", path, id);
      addComponent(sink, {
        id: jobComponentId,
        kind: "pipeline",
        layer: "delivery",
        name: typeof job.name === "string" ? job.name.slice(0, 200) : id,
        locator: `${path}#jobs/${id}`,
        environmentIds: [],
        versions: [],
        observations: [{ dimension: "configuration", state: "configured", environmentId: null, observedAt: sink.capturedAt, confidence: "high", evidenceIds: [evidenceId] }],
        evidenceIds: [evidenceId],
      }, collector);
      jobs.push({ componentId: jobComponentId, id, name: typeof job.name === "string" ? job.name.slice(0, 200) : id, needs, missingNeeds, sourceEvidenceId: evidenceId, runScripts: [...runScripts].sort(), deploysTarget, isTestGate });
    }

    const jobComponentByKey = new Map(jobs.map((job) => [job.id, job.componentId]));
    for (const job of jobs) {
      for (const prerequisiteId of job.needs) {
        const prerequisiteComponentId = jobComponentByKey.get(prerequisiteId);
        if (!prerequisiteComponentId) continue;
        addRelationship(sink, {
          id: stableId("relationship", sink.projectId, job.componentId, prerequisiteComponentId, "depends_on"),
          fromId: job.componentId,
          toId: prerequisiteComponentId,
          type: "depends_on",
          environmentIds: [],
          confidence: "high",
          evidenceIds: [evidenceId],
        }, collector);
      }
    }
    facts.workflows.push({ path, pipelineComponentId: pipelineId, workflowEvidenceId: evidenceId, parseStatus, hasDynamicNeeds, jobs, hasLiteralTestGate: jobs.some((job) => job.isTestGate), ambiguityReasons: [...new Set(ambiguityReasons)] });
  }
  addCoverage(sink, collector, anyFailed ? "failed" : "supported", ".github/workflows", anyFailed ? "One or more workflows had malformed or unresolved declarations; rule consumers must honor per-workflow parse status." : "Parsed workflow names, literal job prerequisites, and allowlisted test/deploy signals only.");
}

function isBoundedWorkflow(value: unknown, depth: number, counter: { count: number }): boolean {
  if (depth > 64 || counter.count > 20_000) return false;
  counter.count += 1;
  if (Array.isArray(value)) return value.every((item) => isBoundedWorkflow(item, depth + 1, counter));
  const object = record(value);
  if (!object) return true;
  return Object.values(object).every((item) => isBoundedWorkflow(item, depth + 1, counter));
}

function extractScriptNames(run: string, knownScripts: ReadonlySet<string>): string[] {
  // Inspect the literal command only for recognized package-manager script invocations; never execute or store it.
  const matches = run.matchAll(/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([A-Za-z0-9:_-]{1,100})\b/g);
  return [...new Set([...matches].map((match) => match[1]!).filter((name) => knownScripts.has(name)))];
}
