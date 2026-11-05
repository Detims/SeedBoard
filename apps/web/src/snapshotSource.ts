import { assertSnapshot, type Snapshot } from "@modernizer/contracts";
import demoSnapshot from "../../../fixtures/demo.snapshot.json";

export type ProjectSummary = { id: string; name: string; createdAt: string };

export interface SnapshotSource {
  loadSnapshot(): Promise<Snapshot>;
  listProjects?(): Promise<ProjectSummary[]>;
  selectProject?(projectId: string): Promise<Snapshot>;
  registerProject?(input: { rootPath: string; name?: string }): Promise<{
    id: string;
    name: string;
    createdAt: string;
  }>;
  scanLatest?(): Promise<Snapshot>;
  saveDecision?(
    projectId: string,
    fingerprint: string,
    state: "accepted" | "dismissed",
    reason: string,
  ): Promise<void>;
  exportSnapshot?(snapshotId: string, format: "json" | "backlog" | "appendix"): Promise<Blob>;
  loadLayout?(projectId: string): Promise<Record<string, { x: number; y: number }> | null>;
  saveLayout?(
    projectId: string,
    name: string,
    positions: Record<string, { x: number; y: number }>,
  ): Promise<void>;
  listHistory?(projectId: string): Promise<
    Array<{
      id: string;
      capturedAt: string;
      assessmentStatus: string;
      componentCount: number;
      relationshipCount: number;
    }>
  >;
  compareSnapshots?(
    targetId: string,
    baseId: string,
  ): Promise<{
    added: string[];
    removed: string[];
    changed: Array<{ id: string; fields: string[] }>;
  }>;
  readonly mode?: "demo" | "local";
}

export const demoSnapshotSource: SnapshotSource = {
  mode: "demo",
  async loadSnapshot() {
    assertSnapshot(demoSnapshot);
    return demoSnapshot;
  },
};
