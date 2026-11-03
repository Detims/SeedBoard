import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", ".git", "dist", "coverage"]);
const markdownFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      markdownFiles.push(path);
    }
  }
}

await walk(root);
const failures = [];
for (const file of markdownFiles) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/!?[[^]]*](([^)]+))/g)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const pathname = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
    const resolved = resolve(dirname(file), pathname);
    const relative = resolved.slice(root.length + 1);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      failures.push(`${file.slice(root.length + 1)}: link escapes workspace: ${target}`);
      continue;
    }
    try {
      await stat(resolved);
    } catch {
      failures.push(`${file.slice(root.length + 1)}: missing link target: ${target}`);
      continue;
    }
    if (relative.endsWith(".md") && !markdownFiles.includes(resolved)) {
      failures.push(`${file.slice(root.length + 1)}: link target is not indexed: ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${markdownFiles.length} Markdown files; all local links resolve.`);
}
