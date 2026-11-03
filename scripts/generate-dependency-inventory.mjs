import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = parse(await readFile(resolve(root, "pnpm-lock.yaml"), "utf8"));
const direct = new Map();
for (const [workspace, importer] of Object.entries(lock.importers ?? {})) {
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, item] of Object.entries(importer[group] ?? {})) {
      if (item.version?.startsWith("link:")) continue;
      direct.set(`${workspace}:${name}`, group === "dependencies" ? "direct" : "development");
    }
  }
}

const entries = Object.entries(lock.packages ?? {})
  .map(([encoded, metadata]) => {
    const base = encoded.split("(", 1)[0];
    const delimiter = base.startsWith("@")
      ? base.indexOf("@", base.indexOf("/") + 1)
      : base.lastIndexOf("@");
    if (delimiter < 1) throw new Error(`Unsupported lockfile package key: ${encoded}`);
    const name = base.slice(0, delimiter);
    const version = base.slice(delimiter + 1);
    const directScopes = [...direct.entries()]
      .filter(([key]) => key.endsWith(`:${name}`))
      .map(([, role]) => role);
    return {
      name,
      version,
      scope: directScopes.includes("direct")
        ? "direct"
        : directScopes.includes("development")
          ? "development"
          : "transitive",
      license: metadata.license ?? "not recorded in lockfile",
      registryReference: `https://www.npmjs.com/package/${name}`,
      referenceStatus: "registry metadata link; vendor documentation not individually reviewed",
    };
  })
  .sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );

const content = `${JSON.stringify({ generatedFrom: "pnpm-lock.yaml", packageCount: entries.length, packages: entries }, null, 2)}\n`;
const output = resolve(root, "docs/dependency-inventory.json");
if (process.argv.includes("--check")) {
  const existing = await readFile(output, "utf8").catch(() => "");
  if (existing !== content) {
    console.error("docs/dependency-inventory.json is stale; run pnpm docs:inventory:generate.");
    process.exitCode = 1;
  } else {
    console.log(
      `Dependency inventory matches pnpm-lock.yaml (${entries.length} package versions).`,
    );
  }
} else {
  await writeFile(output, content);
  console.log(`Wrote ${entries.length} locked package records to docs/dependency-inventory.json.`);
}
