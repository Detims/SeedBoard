import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../..");
const syntheticRoot = resolve(root, "packages/discovery/fixtures/synthetic-target");
const dataDirectory = await mkdtemp(resolve(tmpdir(), "modernizer-e2e-"));
const port = await availablePort();
const base = `http://127.0.0.1:${port}/api/v1`;
let server;

try {
  server = spawn(process.execPath, [resolve(root, "apps/api/dist/server.js")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MODERNIZER_DATA_DIR: dataDirectory },
    stdio: "ignore",
  });
  await waitForReady();
  const registration = spawnSync(process.execPath, [
    resolve(root, "apps/cli/dist/index.js"), "project", "register", syntheticRoot, "--name", "Synthetic acceptance target",
  ], { cwd: root, env: { ...process.env, MODERNIZER_DATA_DIR: dataDirectory }, encoding: "utf8" });
  if (registration.status !== 0) throw new Error(`CLI registration failed: ${registration.stderr.trim()}`);

  const bootstrap = await fetch(`${base}/session`);
  const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
  const csrf = (await bootstrap.json()).data;
  if (!cookie || !csrf?.csrfHeader || !csrf?.csrfValue) throw new Error("Session bootstrap was incomplete.");
  const request = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        "sec-fetch-site": "same-origin",
        cookie,
        [csrf.csrfHeader]: csrf.csrfValue,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    return { response, data: contentType.includes("json") ? await response.json() : await response.text() };
  };
  const projects = await request("/projects");
  ensure(projects.response.ok && projects.data.data.length === 1, "registered project is visible through the local API");
  const projectId = projects.data.data[0].id;

  const started = await request(`/projects/${encodeURIComponent(projectId)}/scans`, { method: "POST", body: "{}" });
  ensure(started.response.status === 202, "scan is queued");
  let job = started.data.data;
  const deadline = Date.now() + 120_000;
  while (["queued", "running", "cancelling"].includes(job.state) && Date.now() < deadline) {
    await delay(100);
    const status = await request(`/scans/${encodeURIComponent(job.id)}`);
    job = status.data.data;
  }
  ensure(job.state === "succeeded" || job.state === "partial", `scan reached a publishable state (${job.state})`);
  ensure(Boolean(job.snapshotId), "scan published an immutable snapshot");

  const loaded = await request(`/snapshots/${encodeURIComponent(job.snapshotId)}`);
  ensure(loaded.response.ok, "published snapshot can be loaded");
  const snapshot = loaded.data.data;
  ensure(snapshot.demo === false, "static target scan is not labeled as demo");
  ensure(snapshot.documentation.length === snapshot.components.length, "every component has documentation coverage");
  ensure(snapshot.components.some((item) => item.kind === "migration"), "migration files appear in the inventory");
  ensure(snapshot.components.some((item) => item.kind === "pipeline"), "workflow files appear in the inventory");

  const appendix = await request(`/snapshots/${encodeURIComponent(job.snapshotId)}/export?format=appendix`);
  ensure(appendix.response.ok && appendix.data.includes("Documentation appendix"), "sanitized appendix export is available");
  const history = await request(`/projects/${encodeURIComponent(projectId)}/snapshots?limit=10`);
  ensure(history.response.ok && history.data.data.length === 1, "snapshot history contains the published assessment");
  process.stdout.write("T7 local API/CLI E2E passed: register → scan → snapshot → appendix → history.\n");
} finally {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolvePromise) => server.once("exit", resolvePromise));
  }
  await rm(dataDirectory, { recursive: true, force: true });
}

async function availablePort() {
  const listener = createServer();
  await new Promise((resolvePromise, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolvePromise));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve an API port.");
  await new Promise((resolvePromise) => listener.close(resolvePromise));
  return address.port;
}

async function waitForReady() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`API exited with status ${server.exitCode}.`);
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch { /* wait for the loopback server to bind */ }
    await delay(150);
  }
  throw new Error("API did not become ready within 15 seconds.");
}

function ensure(condition, message) {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`);
}
