import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const processes = [];
let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
  const timeout = setTimeout(() => {
    for (const child of processes) child.kill("SIGKILL");
  }, 2500);
  timeout.unref();
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

for (const [name, file, args] of [
  ["api", "apps/api/dist/server.js", []],
  ["web", "apps/web/node_modules/vite/bin/vite.js", ["--config", "vite.config.ts"]],
]) {
  const cwd = name === "web" ? resolve(root, "apps/web") : root;
  const child = spawn(process.execPath, [resolve(root, file), ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  processes.push(child);
  child.once("error", (error) => {
    process.stderr.write(`[${name}] ${error.message}\n`);
    process.exitCode = 1;
    stop();
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    if (code !== 0) process.exitCode = code ?? 1;
    if (signal || code !== 0) stop();
  });
}

process.stdout.write(
  "Modernizer API: http://127.0.0.1:4317\nDashboard: http://127.0.0.1:5173 (use ?demo=1 for the labeled fixture)\n",
);
