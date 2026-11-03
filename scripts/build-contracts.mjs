import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../packages/contracts");
const tsc = resolve(here, "../node_modules/typescript/bin/tsc");

await rm(resolve(packageRoot, "dist"), { recursive: true, force: true });
const result = spawnSync(process.execPath, [tsc, "-p", resolve(packageRoot, "tsconfig.json")], {
  cwd: packageRoot,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Built @modernizer/contracts.");
