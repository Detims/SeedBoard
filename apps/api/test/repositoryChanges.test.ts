import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureRepositoryRevision,
  inspectRepositoryChanges,
  RepositoryRestoreConflict,
  restoreRepositoryFiles,
} from "../src/repositoryChanges.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "seedboard-restore-test-"));
  roots.push(root);
  await git(root, ["init", "-q", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "SeedBoard Test"]);
  await git(root, ["config", "user.email", "seedboard-test@example.invalid"]);
  await writeFile(join(root, "README.md"), "before scan\n");
  await git(root, ["add", "--", "README.md"]);
  await git(root, ["commit", "-qm", "initial"]);
  const sourceRevision = await captureRepositoryRevision(root);
  if (!sourceRevision) throw new Error("Test repository did not produce a commit.");
  return { root, sourceRevision };
}

function git(root: string, args: string[]) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository change previews and restoration", () => {
  it("previews tracked changes and restores selected files to the scan commit", async () => {
    const { root, sourceRevision } = await createRepository();
    await writeFile(join(root, "README.md"), "after scan\n");
    await writeFile(join(root, "new-file.txt"), "new file\n");
    await git(root, ["add", "--", "README.md", "new-file.txt"]);
    await git(root, ["commit", "-qm", "changes after scan"]);

    const preview = await inspectRepositoryChanges(root, sourceRevision);
    expect(preview.available).toBe(true);
    expect(preview.files).toEqual([
      { path: "README.md", status: "M", restorable: true },
      { path: "new-file.txt", status: "A", restorable: true },
    ]);

    const restoredPaths = await restoreRepositoryFiles(root, sourceRevision, {
      currentRevision: preview.currentRevision!,
      changeToken: preview.changeToken!,
      paths: preview.files.map(({ path }) => path),
    });

    expect(restoredPaths).toEqual(["README.md", "new-file.txt"]);
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("before scan\n");
    await expect(readFile(join(root, "new-file.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await inspectRepositoryChanges(root, sourceRevision)).files).toEqual([]);
  });

  it("rejects restore when a selected working-tree file changes after preview", async () => {
    const { root, sourceRevision } = await createRepository();
    await writeFile(join(root, "README.md"), "first edit\n");
    const preview = await inspectRepositoryChanges(root, sourceRevision);
    expect(preview.files).toEqual([{ path: "README.md", status: "M", restorable: true }]);
    await writeFile(join(root, "README.md"), "newer edit after preview\n");

    await expect(
      restoreRepositoryFiles(root, sourceRevision, {
        currentRevision: preview.currentRevision!,
        changeToken: preview.changeToken!,
        paths: ["README.md"],
      }),
    ).rejects.toBeInstanceOf(RepositoryRestoreConflict);
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("newer edit after preview\n");
  });

  it("refuses to overwrite staged changes", async () => {
    const { root, sourceRevision } = await createRepository();
    await writeFile(join(root, "README.md"), "staged work\n");
    await git(root, ["add", "--", "README.md"]);
    const preview = await inspectRepositoryChanges(root, sourceRevision);
    expect(preview.files).toEqual([{ path: "README.md", status: "M", restorable: false }]);

    await expect(
      restoreRepositoryFiles(root, sourceRevision, {
        currentRevision: preview.currentRevision!,
        changeToken: preview.changeToken!,
        paths: ["README.md"],
      }),
    ).rejects.toThrow(/staged changes/);
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("staged work\n");
  });

  it("reports unavailable when the scan has no Git revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "seedboard-no-git-"));
    roots.push(root);

    expect(await captureRepositoryRevision(root)).toBeNull();
    await expect(inspectRepositoryChanges(root, null)).resolves.toMatchObject({
      available: false,
      files: [],
    });
  });
});
