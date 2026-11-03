import { assertSnapshot, type Snapshot } from "@modernizer/contracts";
import demoSnapshot from "../../../fixtures/demo.snapshot.json";

export interface SnapshotSource {
  loadSnapshot(): Promise<Snapshot>;
}

export const demoSnapshotSource: SnapshotSource = {
  async loadSnapshot() {
    assertSnapshot(demoSnapshot);
    return demoSnapshot;
  },
};
