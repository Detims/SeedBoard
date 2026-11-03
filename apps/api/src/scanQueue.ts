import { randomUUID } from "node:crypto";
import type { Snapshot } from "@modernizer/contracts";
import {
  ModernizerStore,
  ResourceNotFoundError,
  ScanConflictError,
  type RegisteredProject,
  type ScanJob,
  type ScanProgress,
} from "./storage.js";

export type ScanIssue = { code: string; message: string };
export type ScanOutcome = { snapshot: Snapshot; issues?: ScanIssue[] };

export type ScanContext = {
  signal: AbortSignal;
  reportProgress(progress: ScanProgress & { stage: string }): void;
};

export type ScanRunner = (
  project: RegisteredProject,
  context: ScanContext,
) => Promise<ScanOutcome>;

type QueueItem = { jobId: string; abortController: AbortController };

const activeStates = new Set(["queued", "running", "cancelling"]);

export class ScanQueue {
  readonly #store: ModernizerStore;
  readonly #runner: ScanRunner | undefined;
  readonly #pending: QueueItem[] = [];
  readonly #activeByJob = new Map<string, QueueItem>();
  readonly #changed: (() => void) | undefined;
  #active: QueueItem | null = null;
  #closed = false;
  #pumpPromise: Promise<void> | null = null;

  constructor(options: {
    store: ModernizerStore;
    runner?: ScanRunner;
    onChange?: () => void;
    recover?: boolean;
  }) {
    this.#store = options.store;
    this.#runner = options.runner;
    this.#changed = options.onChange;
    if (options.recover ?? true) this.#store.markInterruptedJobs();
  }

  enqueue(projectId: string): ScanJob {
    if (this.#closed) throw new ScanConflictError("The scan worker is shutting down.");
    if (!this.#runner) throw new ScannerUnavailableError();
    if (!this.#store.getProject(projectId)) throw new ResourceNotFoundError("Project not found.");

    const jobs = this.#store.listActiveJobs();
    if (jobs.some((job) => job.projectId === projectId)) {
      throw new ScanConflictError("A scan for this project is already active.");
    }
    const queuedCount = jobs.filter((job) => job.state === "queued").length;
    if (queuedCount >= 1 || jobs.length >= 2) {
      throw new ScanConflictError("The local scan queue is full.");
    }

    const job = this.#store.createScanJob(projectId);
    const item = { jobId: job.id, abortController: new AbortController() };
    this.#activeByJob.set(job.id, item);
    this.#pending.push(item);
    this.#notify();
    if (!this.#pumpPromise) {
      this.#pumpPromise = this.#pump().finally(() => {
        this.#pumpPromise = null;
        if (this.#pending.length > 0 && !this.#closed) this.#startPump();
      });
    }
    return job;
  }

  get(jobId: string): ScanJob | null {
    return this.#store.getScanJob(jobId);
  }

  cancel(jobId: string): ScanJob {
    const existing = this.#store.getScanJob(jobId);
    if (!existing) throw new ResourceNotFoundError("Scan not found.");
    if (!activeStates.has(existing.state)) return existing;
    const item = this.#activeByJob.get(jobId);

    if (existing.state === "queued") {
      const index = this.#pending.findIndex((entry) => entry.jobId === jobId);
      if (index >= 0) this.#pending.splice(index, 1);
      this.#activeByJob.delete(jobId);
      const job = this.#store.updateScanJob(jobId, {
        state: "cancelled",
        stage: "cancelled",
      });
      this.#notify();
      return job;
    }

    if (item && existing.state === "running") {
      const job = this.#store.cancelQueuedJob(jobId);
      item.abortController.abort();
      this.#notify();
      return job;
    }
    return existing;
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const queued of this.#pending.splice(0)) {
      this.#activeByJob.delete(queued.jobId);
      const job = this.#store.getScanJob(queued.jobId);
      if (job && activeStates.has(job.state)) {
        this.#store.updateScanJob(queued.jobId, {
          state: "interrupted",
          stage: "interrupted",
        });
      }
    }
    if (this.#active) {
      const current = this.#active;
      current.abortController.abort();
      const job = this.#store.getScanJob(current.jobId);
      if (job && activeStates.has(job.state)) {
        this.#store.updateScanJob(current.jobId, {
          state: "interrupted",
          stage: "interrupted",
        });
      }
    }
    if (this.#pumpPromise) await this.#pumpPromise.catch(() => undefined);
    this.#activeByJob.clear();
  }

  #startPump(): void {
    if (this.#pumpPromise || this.#closed) return;
    this.#pumpPromise = this.#pump().finally(() => {
      this.#pumpPromise = null;
      if (this.#pending.length > 0 && !this.#closed) this.#startPump();
    });
  }

  async #pump(): Promise<void> {
    while (!this.#closed && this.#pending.length > 0) {
      const item = this.#pending.shift();
      if (!item) continue;
      const queued = this.#store.getScanJob(item.jobId);
      if (!queued || queued.state !== "queued") {
        this.#activeByJob.delete(item.jobId);
        continue;
      }
      const project = this.#store.getProject(queued.projectId);
      if (!project) {
        this.#store.updateScanJob(item.jobId, {
          state: "failed",
          stage: "failed",
          issues: ["Project was removed before its scan started."],
        });
        this.#notify();
        continue;
      }

      this.#active = item;
      this.#store.updateScanJob(item.jobId, { state: "running", stage: "starting" });
      this.#notify();
      try {
        const result = await this.#runner!(project, {
          signal: item.abortController.signal,
          reportProgress: (progress) => {
            const latest = this.#store.getScanJob(item.jobId);
            if (latest?.state === "running") {
              this.#store.updateScanJob(item.jobId, {
                stage: progress.stage,
                progress: { completed: progress.completed, total: progress.total },
              });
              this.#notify();
            }
          },
        });
        if (item.abortController.signal.aborted) {
          this.#finishCancelled(item.jobId);
        } else {
          const summary = this.#store.publishSnapshot(item.jobId, result.snapshot);
          if (result.issues?.length) {
            const issues = sanitizeIssues(result.issues);
            this.#store.updateScanJob(item.jobId, {
              issues,
              state: summary.assessmentStatus === "partial" ? "partial" : "succeeded",
            });
          }
          this.#notify();
        }
      } catch (error) {
        const latest = this.#store.getScanJob(item.jobId);
        if (latest?.state === "interrupted") {
          // Shutdown already marked the job; do not overwrite its recovery state.
        } else if (item.abortController.signal.aborted) {
          this.#finishCancelled(item.jobId);
        } else {
          this.#store.updateScanJob(item.jobId, {
            state: "failed",
            stage: "failed",
            issues: [safeScanFailure(error)],
          });
        }
        this.#notify();
      } finally {
        this.#activeByJob.delete(item.jobId);
        this.#active = null;
      }
    }
  }

  #finishCancelled(jobId: string): void {
    const job = this.#store.getScanJob(jobId);
    if (job && activeStates.has(job.state)) {
      this.#store.updateScanJob(jobId, { state: "cancelled", stage: "cancelled" });
    }
  }

  #notify(): void {
    this.#changed?.();
  }
}

export class ScannerUnavailableError extends Error {}

function safeScanFailure(error: unknown): string {
  if (error instanceof ScannerUnavailableError) return "No scan adapter is configured.";
  return "The scan failed. Review collector coverage and local logs for a safe issue code.";
}

function sanitizeIssues(issues: ScanIssue[]): string[] {
  return issues.slice(0, 100).map(({ code }) => {
    const clean = code.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
    return clean || "COLLECTOR_ISSUE";
  });
}

export function createSyntheticScanRunner(
  snapshotFactory: (project: RegisteredProject) => Snapshot,
  delayMs = 10,
): ScanRunner {
  return async (project, context) => {
    context.reportProgress({ stage: "synthetic", completed: 0, total: 1 });
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(resolvePromise, delayMs);
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Scan cancelled.", "AbortError"));
      };
      if (context.signal.aborted) abort();
      else context.signal.addEventListener("abort", abort, { once: true });
    });
    context.reportProgress({ stage: "validating", completed: 1, total: 1 });
    return { snapshot: snapshotFactory(project) };
  };
}

export function createEmptySnapshot(project: RegisteredProject): Snapshot {
  const capturedAt = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: randomUUID(),
    projectId: project.id,
    sourceRevision: null,
    capturedAt,
    demo: false,
    environments: [],
    evidence: [
      {
        id: "scan-root",
        sourceType: "scan",
        path: null,
        url: null,
        line: null,
        observedAt: capturedAt,
        description: "Scan completed without eligible architecture declarations.",
      },
    ],
    components: [],
    relationships: [],
    coverage: [
      {
        collector: "foundation-placeholder",
        status: "unsupported",
        scope: "Application inventory",
        observedAt: capturedAt,
        reason: "No discovery adapter is wired yet.",
      },
    ],
    suggestions: [],
    documentation: [],
  };
}

