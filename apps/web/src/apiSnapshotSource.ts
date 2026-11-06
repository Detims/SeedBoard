import { assertSnapshot, type Snapshot } from "@modernizer/contracts";
import type {
  PackageAdvisoryReport,
  ProjectSummary,
  RepositoryChanges,
  SnapshotSource,
} from "./snapshotSource.js";

type Envelope<T> = { data: T; meta: { requestId: string; nextCursor?: string | null } };
type Job = { id: string; state: string; snapshotId: string | null };

export class LocalApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "LocalApiError";
  }
}

export class LocalApiSnapshotSource implements SnapshotSource {
  readonly mode = "local" as const;
  #csrf: { header: string; value: string } | null = null;
  #projectId: string | null = null;
  #selectedProject: ProjectSummary | null = null;

  getSelectedProject(): ProjectSummary | null {
    return this.#selectedProject;
  }

  async loadSnapshot(): Promise<Snapshot> {
    await this.#bootstrap();
    const projects = await this.listProjects();
    if (projects.length === 0)
      throw new LocalApiError(
        "No project is registered yet. Add a local folder to this dashboard to get started.",
        "PROJECTS_EMPTY",
      );
    const savedId = window.localStorage.getItem("modernizer:last-project");
    const project = projects.find((item) => item.id === savedId) ?? projects[0]!;
    return this.#loadLatestSnapshot(project);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.#request<ProjectSummary[]>("/projects");
  }

  async removeProject(projectId: string): Promise<void> {
    await this.#request<{ removed: boolean }>(`/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
      body: "{}",
    });
    if (this.#projectId === projectId) {
      this.#projectId = null;
      this.#selectedProject = null;
      window.localStorage.removeItem("modernizer:last-project");
    }
  }

  async selectProject(projectId: string): Promise<Snapshot> {
    const projects = await this.listProjects();
    const project = projects.find((item) => item.id === projectId);
    if (!project)
      throw new LocalApiError("The selected project is no longer registered.", "NOT_FOUND");
    return this.#loadLatestSnapshot(project);
  }

  async loadSnapshotById(snapshotId: string): Promise<Snapshot> {
    const projectId = this.#projectId;
    if (!projectId)
      throw new LocalApiError("Select a project before choosing a snapshot.", "PROJECTS_EMPTY");
    const history = await this.listHistory(projectId);
    if (!history.some((item) => item.id === snapshotId))
      throw new LocalApiError("The selected snapshot is not part of this project.", "NOT_FOUND");
    return this.#loadSnapshot(snapshotId);
  }

  async #loadLatestSnapshot(project: ProjectSummary): Promise<Snapshot> {
    this.#projectId = project.id;
    this.#selectedProject = project;
    window.localStorage.setItem("modernizer:last-project", project.id);
    const page = await this.#request<Array<{ id: string }>>(
      `/projects/${encodeURIComponent(project.id)}/snapshots?limit=1`,
    );
    if (!page.length)
      throw new LocalApiError(
        `No snapshot exists for ${project.name}. Run the first scan to assess this project.`,
        "SNAPSHOT_EMPTY",
      );
    return this.#loadSnapshot(page[0]!.id);
  }

  async registerProject(input: { rootPath: string; name?: string }): Promise<ProjectSummary> {
    const project = await this.#request<ProjectSummary>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
    this.#projectId = project.id;
    this.#selectedProject = project;
    window.localStorage.setItem("modernizer:last-project", project.id);
    return project;
  }

  async scanLatest(): Promise<Snapshot> {
    if (!this.#projectId) {
      await this.loadSnapshot().catch((error: unknown) => {
        if (!(error instanceof LocalApiError) || error.code !== "SNAPSHOT_EMPTY") throw error;
      });
    }
    if (!this.#projectId)
      throw new LocalApiError(
        "No repository is registered. Use the local CLI to register a folder first.",
        "PROJECTS_EMPTY",
      );
    const job = await this.#request<Job>(`/projects/${encodeURIComponent(this.#projectId)}/scans`, {
      method: "POST",
      body: "{}",
    });
    const startedAt = Date.now();
    let current = job;
    while (["queued", "running", "cancelling"].includes(current.state)) {
      if (Date.now() - startedAt > 10 * 60_000)
        throw new LocalApiError(
          "The scan is still running. Reload later to see its result.",
          "SCAN_TIMEOUT",
        );
      await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 650));
      current = await this.#request<Job>(`/scans/${encodeURIComponent(job.id)}`);
    }
    if (!current.snapshotId)
      throw new LocalApiError(
        `Scan ${current.state}. Review its recorded issue codes and try again.`,
        `SCAN_${current.state.toUpperCase()}`,
      );
    return this.#loadSnapshot(current.snapshotId);
  }

  async checkPackageAdvisories(snapshotId: string): Promise<PackageAdvisoryReport> {
    return this.#request<PackageAdvisoryReport>(
      `/snapshots/${encodeURIComponent(snapshotId)}/package-advisories`,
      { method: "POST", body: JSON.stringify({ shareMetadata: true }) },
    );
  }

  async saveDecision(
    projectId: string,
    fingerprint: string,
    state: "accepted" | "dismissed",
    reason: string,
  ): Promise<void> {
    await this.#request(
      `/projects/${encodeURIComponent(projectId)}/suggestion-decisions/${encodeURIComponent(fingerprint)}`,
      {
        method: "PUT",
        body: JSON.stringify({ state, reason }),
      },
    );
  }

  async exportSnapshot(snapshotId: string, format: "json" | "backlog" | "appendix"): Promise<Blob> {
    await this.#bootstrap();
    const headers = new Headers();
    headers.set(this.#csrf!.header, this.#csrf!.value);
    const response = await fetch(
      `/api/v1/snapshots/${encodeURIComponent(snapshotId)}/export?format=${format}`,
      { headers, credentials: "same-origin" },
    );
    if (!response.ok)
      throw new LocalApiError(
        `Export failed with HTTP ${response.status}.`,
        `HTTP_${response.status}`,
      );
    return response.blob();
  }

  async loadLayout(projectId: string): Promise<Record<string, { x: number; y: number }> | null> {
    try {
      const saved = await this.#request<{ positions: Record<string, { x: number; y: number }> }>(
        `/projects/${encodeURIComponent(projectId)}/layouts/architecture`,
      );
      return saved.positions;
    } catch (error) {
      if (error instanceof LocalApiError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }

  async saveLayout(
    projectId: string,
    name: string,
    positions: Record<string, { x: number; y: number }>,
  ): Promise<void> {
    await this.#request(
      `/projects/${encodeURIComponent(projectId)}/layouts/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        body: JSON.stringify({ positions, viewport: { x: 0, y: 0, zoom: 1 }, pinnedIds: [] }),
      },
    );
  }

  async listHistory(projectId: string) {
    return this.#request<
      Array<{
        id: string;
        capturedAt: string;
        assessmentStatus: string;
        componentCount: number;
        relationshipCount: number;
      }>
    >(`/projects/${encodeURIComponent(projectId)}/snapshots?limit=100`);
  }

  async compareSnapshots(targetId: string, baseId: string) {
    return this.#request<{
      added: string[];
      removed: string[];
      changed: Array<{ id: string; fields: string[] }>;
    }>(`/snapshots/${encodeURIComponent(targetId)}/diff?base=${encodeURIComponent(baseId)}`);
  }

  async getRepositoryChanges(snapshotId: string): Promise<RepositoryChanges> {
    return this.#request<RepositoryChanges>(
      `/snapshots/${encodeURIComponent(snapshotId)}/repository-changes`,
    );
  }

  async restoreProjectFiles(
    projectId: string,
    snapshotId: string,
    preview: Pick<RepositoryChanges, "currentRevision" | "changeToken">,
    paths: string[],
  ): Promise<{ restoredPaths: string[]; changes: RepositoryChanges }> {
    return this.#request(`/projects/${encodeURIComponent(projectId)}/restore-files`, {
      method: "POST",
      body: JSON.stringify({
        snapshotId,
        currentRevision: preview.currentRevision,
        changeToken: preview.changeToken,
        paths,
      }),
    });
  }

  async #loadSnapshot(id: string): Promise<Snapshot> {
    const snapshot = await this.#request<Snapshot>(`/snapshots/${encodeURIComponent(id)}`);
    assertSnapshot(snapshot);
    return snapshot;
  }

  async #bootstrap(): Promise<void> {
    if (this.#csrf) return;
    const response = await fetch("/api/v1/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const envelope = await this.#read<{ csrfHeader: string; csrfValue: string }>(response);
    this.#csrf = { header: envelope.csrfHeader, value: envelope.csrfValue };
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    await this.#bootstrap();
    const headers = new Headers(init.headers);
    headers.set(this.#csrf!.header, this.#csrf!.value);
    if (init.body) headers.set("content-type", "application/json");
    const response = await fetch(`/api/v1${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
    });
    return this.#read<T>(response);
  }

  async #read<T>(response: Response): Promise<T> {
    const parsed = (await response.json()) as
      Envelope<T> | { error?: { code?: string; message?: string } };
    if (!response.ok || !("data" in parsed)) {
      const error = "error" in parsed ? parsed.error : undefined;
      throw new LocalApiError(
        error?.message ?? `Local API returned HTTP ${response.status}.`,
        error?.code ?? `HTTP_${response.status}`,
      );
    }
    return parsed.data;
  }
}

export const localApiSnapshotSource = new LocalApiSnapshotSource();
