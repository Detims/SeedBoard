import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseProjectConfig, scanProject, SafeSource } from "../src/index.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "modernizer-discovery-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bounded discovery", () => {
  it("scans the checked-in synthetic target fixture without claiming runtime state", async () => {
    const root = fileURLToPath(new URL("../fixtures/synthetic-target/", import.meta.url));
    const result = await scanProject({ rootPath: root, projectId: "synthetic-fixture" });
    expect(
      result.components.some(
        ({ kind, locator }) =>
          kind === "migration" &&
          locator === "prisma/migrations/20260101000000_initial/migration.sql",
      ),
    ).toBe(true);
    expect(
      result.coverage.some(
        ({ collector, status }) => collector === "migration-files" && status === "supported",
      ),
    ).toBe(true);
    expect(result.facts.workflows[0]?.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "verify", isTestGate: true }),
        expect.objectContaining({ id: "release", deploysTarget: true, needs: ["verify"] }),
      ]),
    );
    expect(
      result.components.every(({ versions }) =>
        versions.every(({ facet }) => facet !== "deployed"),
      ),
    ).toBe(true);
  });

  it("produces stable identities and preserves workspace and resolved dependency scope", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "demo", workspaces: ["apps/*"] }),
    );
    await writeFile(
      join(root, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "^18.0.0" },
        scripts: { test: "vitest run" },
      }),
    );
    await writeFile(
      join(root, "package-lock.json"),
      JSON.stringify({
        name: "demo",
        lockfileVersion: 3,
        packages: {
          "": { name: "demo", workspaces: ["apps/*"] },
          "apps/web": { name: "web", dependencies: { react: "^18.0.0" } },
          "node_modules/react": { version: "18.3.1" },
        },
      }),
    );

    const options = {
      rootPath: root,
      projectId: "sample-project",
      clock: () => new Date("2026-01-02T03:04:05.000Z"),
    };
    const first = await scanProject(options);
    const second = await scanProject(options);
    expect(first.components.map(({ id }) => id)).toEqual(second.components.map(({ id }) => id));
    expect(first.facts.workspaces).toContainEqual(
      expect.objectContaining({ path: "apps/web", componentId: expect.any(String) }),
    );
    expect(first.facts.dependencies).toContainEqual(
      expect.objectContaining({
        name: "react",
        version: "18.3.1",
        resolved: true,
        workspacePath: "apps/web",
      }),
    );
  });

  it("never inventories or reads excluded secret and database files", async () => {
    const root = await makeRoot();
    await writeFile(join(root, ".env.production"), "API_TOKEN=synthetic-secret");
    await writeFile(join(root, "private.key"), "synthetic-private-key");
    await writeFile(join(root, "local.sqlite"), "synthetic-db");
    const source = await SafeSource.open({ rootPath: root });
    const { files } = await source.walk();
    expect([...files.keys()]).toEqual([]);
    await expect(source.read(".env.production")).rejects.toThrow();
  });

  it("rejects unsafe declarations and surfaces malformed lock/workflow input", async () => {
    const unsafe = parseProjectConfig(
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          components: [
            { key: "x", kind: "database", layer: "data", name: "db", locator: "../outside" },
          ],
        }),
      ),
    );
    expect(unsafe.ok).toBe(false);

    const root = await makeRoot();
    await writeFile(join(root, "package.json"), "{ malformed");
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await writeFile(join(root, ".github", "workflows", "ci.yml"), "jobs: [bad: yaml");
    const result = await scanProject({ rootPath: root, projectId: "sample-project" });
    expect(result.issues.some(({ collector }) => collector === "node-manifests")).toBe(true);
    expect(result.facts.workflows[0]?.parseStatus).toBe("failed");
  });

  it("stops at configured file and byte limits and supports cancellation", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo" }));
    const oversized = await SafeSource.open({ rootPath: root, budgets: { maxFileBytes: 4 } });
    await oversized.walk();
    await expect(oversized.read("package.json")).rejects.toThrow(/size limit/);

    const controller = new AbortController();
    controller.abort();
    await expect(
      scanProject({ rootPath: root, projectId: "sample-project", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "scan_cancelled" });
  });
});
