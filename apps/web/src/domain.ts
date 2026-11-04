import type { Component, Relationship, Snapshot } from "@modernizer/contracts";

export type LayerFilter = "all" | Component["layer"];

export type InventoryCounts = {
  total: number;
  matching: number;
  relationships: number;
  documented: number;
  partialDocumentation: number;
  undocumented: number;
  unknownObservations: number;
};

export type Point = { x: number; y: number };
export type PositionMap = Record<string, Point>;

export interface LayoutStore {
  load(key: string): PositionMap | null;
  save(key: string, positions: PositionMap): void;
}

export const browserLayoutStore: LayoutStore = {
  load(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const valid: PositionMap = {};
      for (const [id, point] of Object.entries(parsed)) {
        if (
          point &&
          typeof point === "object" &&
          Number.isFinite((point as Point).x) &&
          Number.isFinite((point as Point).y)
        ) {
          valid[id] = { x: (point as Point).x, y: (point as Point).y };
        }
      }
      return valid;
    } catch {
      return null;
    }
  },
  save(key, positions) {
    try {
      window.localStorage.setItem(key, JSON.stringify(positions));
    } catch {
      // Layout persistence is best-effort. The graph remains usable without browser storage.
    }
  },
};

export function getInventoryCounts(snapshot: Snapshot, matching: number): InventoryCounts {
  const documentation = new Map(
    snapshot.documentation.map((record) => [record.componentId, record.status]),
  );
  let documented = 0;
  let partialDocumentation = 0;
  let undocumented = 0;
  let unknownObservations = 0;

  const distinctComponents = new Map(
    snapshot.components.map((component) => [component.id, component]),
  );
  for (const component of distinctComponents.values()) {
    const status = documentation.get(component.id);
    if (status === "complete") documented += 1;
    else if (status === "partial") partialDocumentation += 1;
    else undocumented += 1;
    if (component.observations.some((observation) => observation.state === "unknown")) {
      unknownObservations += 1;
    }
  }

  return {
    total: new Set(snapshot.components.map((component) => component.id)).size,
    matching,
    relationships: snapshot.relationships.length,
    documented,
    partialDocumentation,
    undocumented,
    unknownObservations,
  };
}

export function filterComponents(
  components: Component[],
  query: string,
  layer: LayerFilter,
): Component[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return components.filter((component) => {
    const matchesLayer = layer === "all" || component.layer === layer;
    if (!matchesLayer) return false;
    if (!normalizedQuery) return true;
    return (
      component.name.toLocaleLowerCase().includes(normalizedQuery) ||
      component.kind.replaceAll("_", " ").includes(normalizedQuery) ||
      component.locator.toLocaleLowerCase().includes(normalizedQuery) ||
      component.id.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
}

export function filterOverviewArchitectureComponents(components: Component[]): Component[] {
  return components.filter((component) => component.layer !== "shared");
}

export function deterministicLayout(components: Component[]): PositionMap {
  const columns: Record<Component["layer"], number> = {
    frontend: 0,
    backend: 1,
    shared: 0,
    testing: 2,
    data: 2,
    delivery: 3,
    external: 3,
  };
  const sorted = [...components].sort(
    (left, right) =>
      left.layer.localeCompare(right.layer) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );
  const offsets = new Map<number, number>();
  const positions: PositionMap = {};

  for (const component of sorted) {
    const column = columns[component.layer] ?? 0;
    const row = offsets.get(column) ?? 0;
    offsets.set(column, row + 1);
    positions[component.id] = { x: 70 + column * 285, y: 80 + row * 132 };
  }
  return positions;
}

export function visibleRelationships(
  relationships: Relationship[],
  visibleComponentIds: Set<string>,
): Relationship[] {
  return relationships.filter(
    (relationship) =>
      visibleComponentIds.has(relationship.fromId) && visibleComponentIds.has(relationship.toId),
  );
}
