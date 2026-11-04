import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Snapshot } from "@modernizer/contracts";
import {
  exportBacklogMarkdown,
  exportDocumentationAppendix,
  exportSnapshotJson,
} from "@modernizer/docs";
import {
  type LayoutInput,
  ModernizerStore,
  ResourceNotFoundError,
  ScanConflictError,
  type ScanJob,
  type SnapshotSummary,
} from "./storage.js";
import { LocalRequestSecurity, localSecurityConstants, type SecurityDecision } from "./security.js";
import { ScanQueue, ScannerUnavailableError, type ScanRunner } from "./scanQueue.js";

export type AppOptions = {
  store?: ModernizerStore;
  scanner?: ScanRunner;
  port?: number;
  secureCookies?: boolean;
  sessionKey?: Uint8Array;
  rateClock?: () => number;
  ownsStore?: boolean;
};

type ApiSuccess<T> = { data: T; meta: { requestId: string; nextCursor?: string | null } };
type ApiError = {
  error: { code: string; message: string; retryable: boolean };
  meta: { requestId: string };
};
type ProjectIdParams = { projectId: string };
type ScanIdParams = { scanId: string };
type SnapshotIdParams = { snapshotId: string };
type LayoutParams = { projectId: string; name: string };
type DecisionParams = { projectId: string; fingerprint: string };
type Query = Record<string, string | string[] | undefined>;

const jsonRequestHeader = localSecurityConstants.csrfHeaderName;

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const port = options.port ?? Number(process.env.PORT ?? "4317");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("PORT must be an integer between 1 and 65535.");
  }
  const store = options.store ?? new ModernizerStore();
  const queue = new ScanQueue({
    store,
    ...(options.scanner ? { runner: options.scanner } : {}),
    recover: true,
  });
  const security = new LocalRequestSecurity({
    port,
    ...(options.sessionKey ? { secret: options.sessionKey } : {}),
    ...(options.secureCookies === undefined ? {} : { secureCookies: options.secureCookies }),
    ...(options.rateClock ? { now: options.rateClock } : {}),
  });
  const app = Fastify({ logger: false, bodyLimit: 1_048_576, requestIdHeader: false });

  app.addHook("onRequest", async (request, reply) => {
    const decision = security.checkRequest({
      host: headerString(request.headers.host),
      origin: headerString(request.headers.origin),
      fetchSite: headerString(request.headers["sec-fetch-site"]),
      method: request.method,
      url: request.raw.url,
      cookie: headerString(request.headers.cookie),
      csrfHeader: headerString(request.headers[jsonRequestHeader]),
      contentType: headerString(request.headers["content-type"]),
      remoteAddress: request.ip,
    });
    if (!decision.allowed) sendError(reply, request, decision);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ResourceNotFoundError) {
      return sendError(
        reply,
        request,
        {
          allowed: false,
          statusCode: 403,
          code: "NOT_FOUND",
          message: error.message,
        },
        404,
      );
    }
    if (error instanceof ScanConflictError) {
      return sendError(
        reply,
        request,
        {
          allowed: false,
          statusCode: 400,
          code: "CONFLICT",
          message: error.message,
        },
        409,
      );
    }
    if (error instanceof ScannerUnavailableError) {
      return sendError(
        reply,
        request,
        {
          allowed: false,
          statusCode: 400,
          code: "SCANNER_NOT_CONFIGURED",
          message: "No scan adapter is configured.",
        },
        503,
        true,
      );
    }
    const statusCode =
      error instanceof Error && "statusCode" in error ? error.statusCode : undefined;
    if (error instanceof TypeError || statusCode === 400) {
      return sendError(
        reply,
        request,
        {
          allowed: false,
          statusCode: 400,
          code: "BAD_REQUEST",
          message: error instanceof TypeError ? error.message : "Request validation failed.",
        },
        400,
      );
    }
    return sendError(
      reply,
      request,
      {
        allowed: false,
        statusCode: 400,
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
      500,
      true,
    );
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(
      reply,
      request,
      {
        allowed: false,
        statusCode: 400,
        code: "NOT_FOUND",
        message: "Resource not found.",
      },
      404,
    ),
  );

  app.get("/api/v1/session", async (request, reply) => {
    reply.header("Set-Cookie", security.createSessionCookie());
    reply.header("Cache-Control", "no-store");
    return success(request, {
      csrfHeader: localSecurityConstants.csrfHeaderName,
      csrfValue: localSecurityConstants.csrfHeaderValue,
    });
  });

  app.get("/api/v1/healthz", async (request) =>
    success(request, { service: "modernizer-api", ready: true }),
  );

  app.get("/api/v1/projects", async (request) => success(request, store.listProjects()));

  app.post<{ Params: ProjectIdParams }>(
    "/api/v1/projects/:projectId/scans",
    async (request, reply) => {
      const job = queue.enqueue(request.params.projectId);
      reply.code(202);
      return success(request, scanJobPayload(job));
    },
  );

  app.get<{ Params: ScanIdParams }>("/api/v1/scans/:scanId", async (request) => {
    const job = queue.get(request.params.scanId);
    if (!job) throw new ResourceNotFoundError("Scan not found.");
    return success(request, scanJobPayload(job));
  });

  app.post<{ Params: ScanIdParams }>("/api/v1/scans/:scanId/cancel", async (request) =>
    success(request, scanJobPayload(queue.cancel(request.params.scanId))),
  );

  app.get<{ Params: ProjectIdParams; Querystring: Query }>(
    "/api/v1/projects/:projectId/snapshots",
    async (request) => {
      const limit = parseLimit(request.query.limit);
      const cursor = request.query.cursor;
      if (Array.isArray(cursor)) throw new TypeError("Cursor must appear only once.");
      const page = store.listSnapshots(request.params.projectId, {
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return success(request, page.snapshots, page.nextCursor);
    },
  );

  app.get<{ Params: SnapshotIdParams }>("/api/v1/snapshots/:snapshotId", async (request) => {
    const result = store.getSnapshot(request.params.snapshotId);
    if (!result) throw new ResourceNotFoundError("Snapshot not found.");
    return success(request, result.snapshot);
  });

  app.get<{ Params: SnapshotIdParams; Querystring: Query }>(
    "/api/v1/snapshots/:snapshotId/diff",
    async (request) => {
      const baseId = request.query.base;
      if (typeof baseId !== "string" || baseId.length === 0) {
        throw new TypeError("The base snapshot ID is required.");
      }
      const target = store.getSnapshot(request.params.snapshotId);
      const base = store.getSnapshot(baseId);
      if (!target || !base) throw new ResourceNotFoundError("Snapshot not found.");
      if (target.summary.projectId !== base.summary.projectId) {
        throw new ScanConflictError("Snapshots must belong to the same project.");
      }
      return success(
        request,
        diffSnapshots(base.summary, base.snapshot, target.summary, target.snapshot),
      );
    },
  );

  app.get<{ Params: LayoutParams }>(
    "/api/v1/projects/:projectId/layouts/:name",
    async (request) => {
      if (!store.getProject(request.params.projectId)) {
        throw new ResourceNotFoundError("Project not found.");
      }
      const layout = store.getLayout(request.params.projectId, request.params.name);
      if (!layout) throw new ResourceNotFoundError("Layout not found.");
      return success(request, layout);
    },
  );

  app.put<{ Params: LayoutParams; Body: unknown }>(
    "/api/v1/projects/:projectId/layouts/:name",
    async (request) => {
      const input = validateLayout(request.body);
      const saved = store.saveLayout(request.params.projectId, request.params.name, input);
      return success(request, saved);
    },
  );

  app.put<{ Params: DecisionParams; Body: unknown }>(
    "/api/v1/projects/:projectId/suggestion-decisions/:fingerprint",
    async (request) => {
      const input = validateDecision(request.body);
      const result = store.saveDecision(
        request.params.projectId,
        request.params.fingerprint,
        input,
      );
      return success(request, result);
    },
  );

  app.get<{ Params: SnapshotIdParams; Querystring: Query }>(
    "/api/v1/snapshots/:snapshotId/export",
    async (request, reply) => {
      const format = request.query.format;
      if (Array.isArray(format) || !["json", "backlog", "appendix"].includes(format ?? "")) {
        throw new TypeError("Export format must be json, backlog, or appendix.");
      }
      const result = store.getSnapshot(request.params.snapshotId);
      if (!result) throw new ResourceNotFoundError("Snapshot not found.");
      if (format === "json") {
        reply.type("application/json; charset=utf-8");
        reply.header("Content-Disposition", 'attachment; filename="seedboard-snapshot.json"');
        return exportSnapshotJson(result.snapshot);
      }
      reply.type("text/markdown; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="seedboard-${format}.md"`);
      const content =
        format === "appendix"
          ? exportDocumentationAppendix(result.snapshot)
          : exportBacklogMarkdown(result.snapshot);
      return content;
    },
  );

  app.addHook("onClose", async () => {
    await queue.close();
    if (options.ownsStore ?? !options.store) store.close();
  });

  return app;
}

export function scanJobPayload(job: ScanJob) {
  return {
    id: job.id,
    projectId: job.projectId,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    issues: job.issues,
    snapshotId: job.snapshotId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function success<T>(request: FastifyRequest, data: T, nextCursor?: string | null): ApiSuccess<T> {
  return {
    data,
    meta: {
      requestId: request.id,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
  };
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: SecurityDecision,
  statusCode: number = error.statusCode,
  retryable = false,
): FastifyReply {
  const body: ApiError = {
    error: { code: error.code, message: error.message, retryable },
    meta: { requestId: request.id },
  };
  return reply.code(statusCode).type("application/json").send(body);
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseLimit(value: string | string[] | undefined): number {
  if (value === undefined) return 50;
  if (Array.isArray(value) || !/^[0-9]+$/.test(value)) {
    throw new TypeError("Limit must be an integer between 1 and 200.");
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new TypeError("Limit must be an integer between 1 and 200.");
  }
  return limit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLayout(input: unknown): LayoutInput {
  if (!isRecord(input) || !isRecord(input.positions) || !isRecord(input.viewport)) {
    throw new TypeError("Layout must contain positions, viewport, and pinnedIds.");
  }
  if (Object.keys(input.positions).length > 2000) {
    throw new TypeError("A layout cannot position more than 2000 components.");
  }
  const positions: LayoutInput["positions"] = {};
  for (const [id, point] of Object.entries(input.positions)) {
    if (!id || id.length > 160 || !isRecord(point)) {
      throw new TypeError("Layout position entry is invalid.");
    }
    const { x, y } = point;
    if (
      typeof x !== "number" ||
      !Number.isFinite(x) ||
      Math.abs(x) > 100_000 ||
      typeof y !== "number" ||
      !Number.isFinite(y) ||
      Math.abs(y) > 100_000
    ) {
      throw new TypeError("Layout coordinates must be finite and within range.");
    }
    positions[id] = { x, y };
  }
  const { x, y, zoom } = input.viewport;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    Math.abs(x) > 100_000 ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    Math.abs(y) > 100_000 ||
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    zoom > 10
  ) {
    throw new TypeError("Layout viewport is invalid.");
  }
  if (
    !Array.isArray(input.pinnedIds) ||
    input.pinnedIds.length > 2000 ||
    input.pinnedIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 160)
  ) {
    throw new TypeError("pinnedIds must be a list of component IDs.");
  }
  const pinnedIds = input.pinnedIds as string[];
  if (new Set(pinnedIds).size !== pinnedIds.length) {
    throw new TypeError("pinnedIds must be unique.");
  }
  return { positions, viewport: { x, y, zoom }, pinnedIds };
}

function validateDecision(input: unknown): {
  state: "open" | "accepted" | "dismissed";
  reason: string;
} {
  if (!isRecord(input)) throw new TypeError("Decision body is required.");
  const state = input.state;
  const reason = input.reason;
  if (
    !["open", "accepted", "dismissed"].includes(String(state)) ||
    typeof reason !== "string" ||
    reason.length > 1000
  ) {
    throw new TypeError("Decision state or reason is invalid.");
  }
  if (state === "dismissed" && reason.trim().length === 0) {
    throw new TypeError("Dismissal requires a reason.");
  }
  return { state: state as "open" | "accepted" | "dismissed", reason };
}

type DiffEntity = { id: string; values: Record<string, unknown> };

function diffSnapshots(
  baseSummary: SnapshotSummary,
  base: Snapshot,
  targetSummary: SnapshotSummary,
  target: Snapshot,
) {
  const baseEntities = snapshotEntities(base);
  const targetEntities = snapshotEntities(target);
  const baseMap = new Map(baseEntities.map((entity) => [entity.id, entity]));
  const targetMap = new Map(targetEntities.map((entity) => [entity.id, entity]));
  const added = targetEntities
    .filter(({ id }) => !baseMap.has(id))
    .map(({ id }) => id)
    .sort();
  const removed = baseEntities
    .filter(({ id }) => !targetMap.has(id))
    .map(({ id }) => id)
    .sort();
  const changed = targetEntities
    .flatMap((entity) => {
      const prior = baseMap.get(entity.id);
      if (!prior) return [];
      const fields = new Set([...Object.keys(prior.values), ...Object.keys(entity.values)]);
      const differences = [...fields]
        .filter(
          (field) => JSON.stringify(prior.values[field]) !== JSON.stringify(entity.values[field]),
        )
        .sort();
      return differences.length ? [{ id: entity.id, fields: differences }] : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    baseSnapshotId: baseSummary.id,
    targetSnapshotId: targetSummary.id,
    added,
    removed,
    changed,
  };
}

function snapshotEntities(snapshot: Snapshot): DiffEntity[] {
  return [
    ...snapshot.components.map((component) => ({
      id: `components:${component.id}`,
      values: component as unknown as Record<string, unknown>,
    })),
    ...snapshot.relationships.map((relationship) => ({
      id: `relationships:${relationship.id}`,
      values: relationship as unknown as Record<string, unknown>,
    })),
    ...snapshot.suggestions.map((suggestion) => ({
      id: `suggestions:${suggestion.fingerprint}`,
      values: suggestion as unknown as Record<string, unknown>,
    })),
  ];
}

function renderBacklog(snapshot: Snapshot, store: ModernizerStore): string {
  const lines = [
    "# Modernization backlog",
    "",
    "_Snapshot export; no changes have been applied._",
    "",
  ];
  for (const suggestion of snapshot.suggestions) {
    const decision = store.getDecision(snapshot.projectId, suggestion.fingerprint);
    const title = cleanMarkdown(suggestion.title);
    lines.push(
      `## [${suggestion.category}] ${title}`,
      "",
      `- Priority: ${suggestion.priority}`,
      `- Effort: ${suggestion.effort}`,
      `- Confidence: ${suggestion.confidence}`,
      `- Decision: ${decision?.state ?? "open"}`,
      `- Rule: ${suggestion.ruleId} v${suggestion.ruleVersion}`,
      "",
      cleanMarkdown(suggestion.rationale),
      "",
      "Next step:",
      cleanMarkdown(suggestion.action),
      "",
      "Verification:",
      ...suggestion.verification.map((step) => `- ${cleanMarkdown(step)}`),
      "",
    );
  }
  return lines.join("\n");
}

function renderAppendix(snapshot: Snapshot): string {
  const components = new Map(snapshot.components.map((component) => [component.id, component]));
  const lines = [
    "# Service and component documentation appendix",
    "",
    "_Snapshot-generated inventory. Unknown details remain explicit._",
    "",
  ];
  for (const record of snapshot.documentation) {
    const component = components.get(record.componentId);
    if (!component) continue;
    lines.push(
      `## ${cleanMarkdown(component.name)}`,
      "",
      `- Kind: ${component.kind} (${component.layer})`,
      `- Locator: ${component.locator}`,
      `- Documentation status: ${record.status}`,
    );
    for (const version of component.versions) {
      lines.push(`- ${version.facet} version: ${cleanMarkdown(version.value)}`);
    }
    for (const reference of record.officialReferences) {
      const title = cleanMarkdown(reference.title);
      lines.push(`- Official documentation: [${title}](${safeMarkdownUrl(reference.url)})`);
    }
    if (record.internalPaths.length) {
      lines.push(...record.internalPaths.map((path) => `- Internal guide: ${path}`));
    }
    if (record.gap) lines.push(`- Documentation gap: ${cleanMarkdown(record.gap)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}\[\]<>#+.!|()-]/g, (character) => `\\${character}`);
}

function safeMarkdownUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  if (parsed.username || parsed.password) return "";
  parsed.search = "";
  return parsed.toString().replace(/[()]/g, (character) => (character === "(" ? "%28" : "%29"));
}
