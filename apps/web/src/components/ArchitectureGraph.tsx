import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  MarkerType,
} from "@xyflow/react";
import { ArrowDownRight, Focus, Maximize2, Move3d } from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Component, Relationship } from "@modernizer/contracts";
import { deterministicLayout, visibleRelationships, type PositionMap } from "../domain.js";

type ComponentNodeData = {
  component: Component;
  active: boolean;
};
type ComponentFlowNode = Node<ComponentNodeData, "component">;
type GraphProps = {
  components: Component[];
  relationships: Relationship[];
  matchingComponents: Component[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  positions: PositionMap;
  onPositionsChange: (positions: PositionMap) => void;
  focusNeighbors: boolean;
};

const componentColor: Record<Component["layer"], string> = {
  frontend: "#5e78df",
  backend: "#198775",
  testing: "#8871ce",
  data: "#bf8850",
  delivery: "#497fa4",
  shared: "#697888",
  external: "#ab6683",
};

function relationshipTitle(type: Relationship["type"]): string {
  const titles: Record<Relationship["type"], string> = {
    depends_on: "depends on",
    calls: "calls",
    reads_writes: "reads / writes",
    deploys: "deploys",
    tests: "tests",
    migrates: "migrates",
  };
  return titles[type] ?? type;
}

const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps<ComponentFlowNode>) {
  const component = data.component;
  const symbol = component.kind === "database" || component.kind === "migration"
    ? "DB"
    : component.kind === "external_service" || component.kind === "api_endpoint"
      ? "API"
      : component.kind === "test_suite"
        ? "QA"
        : component.kind === "pipeline"
          ? "CI"
          : component.kind === "package"
            ? "PKG"
            : component.kind === "runtime"
              ? "RUN"
              : component.layer.slice(0, 3).toUpperCase();
  return (
    <div className={`flow-node ${selected ? "selected" : ""}`} data-layer={component.layer}>
      <span className={`flow-node-mark ${component.layer}`} aria-hidden="true">{symbol}</span>
      <span className="flow-node-copy">
        <strong title={component.name}>{component.name}</strong>
        <small>{component.kind.replaceAll("_", " ")}</small>
      </span>
      <span className={`flow-node-state ${data.active ? "active" : "quiet"}`} aria-label={data.active ? "Selected component" : "Component"} />
      <span className="flow-node-layer">{component.layer}</span>
    </div>
  );
});

const nodeTypes = { component: ComponentNode };

export function ArchitectureGraph(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <ArchitectureCanvas {...props} />
    </ReactFlowProvider>
  );
}

function ArchitectureCanvas({
  components,
  relationships,
  matchingComponents,
  selectedId,
  onSelect,
  positions,
  onPositionsChange,
  focusNeighbors,
}: GraphProps) {
  const { fitView } = useReactFlow();
  const matchingIds = useMemo(() => new Set(matchingComponents.map(({ id }) => id)), [matchingComponents]);
  const focusedIds = useMemo(() => {
    if (!focusNeighbors || !selectedId) return matchingIds;
    const connected = new Set(matchingIds.has(selectedId) ? [selectedId] : []);
    for (const relationship of relationships) {
      if (relationship.fromId === selectedId && matchingIds.has(relationship.toId)) {
        connected.add(relationship.toId);
      }
      if (relationship.toId === selectedId && matchingIds.has(relationship.fromId)) {
        connected.add(relationship.fromId);
      }
    }
    return connected;
  }, [focusNeighbors, matchingIds, relationships, selectedId]);
  const visibleComponents = useMemo(
    () => components.filter((component) => focusedIds.has(component.id)),
    [components, focusedIds],
  );
  const positionsWithDefaults = useMemo(
    () => ({ ...deterministicLayout(components), ...positions }),
    [components, positions],
  );
  const initialNodes = useMemo<ComponentFlowNode[]>(
    () => visibleComponents.map((component) => ({
      id: component.id,
      type: "component",
      position: positionsWithDefaults[component.id] ?? { x: 0, y: 0 },
      data: { component, active: component.id === selectedId },
      selected: component.id === selectedId,
      ariaLabel: `${component.name}, ${component.kind.replaceAll("_", " ")}, ${component.layer}`,
    })),
    [visibleComponents, positionsWithDefaults, selectedId],
  );
  const visibleIds = useMemo(() => new Set(visibleComponents.map(({ id }) => id)), [visibleComponents]);
  const visibleEdges = useMemo(() => visibleRelationships(relationships, visibleIds), [relationships, visibleIds]);
  const initialEdges = useMemo<Edge[]>(() => visibleEdges.map((relationship) => ({
    id: relationship.id,
    source: relationship.fromId,
    target: relationship.toId,
    type: "smoothstep",
    label: relationshipTitle(relationship.type),
    labelStyle: { fill: "#718093", fontSize: 9, fontWeight: 600 },
    labelBgStyle: { fill: "#fbfcfd", fillOpacity: 0.94 },
    labelBgPadding: [4, 5] as [number, number],
    labelBgBorderRadius: 5,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#b6c1cb", width: 14, height: 14 },
    style: { stroke: "#b6c1cb", strokeWidth: 1.35 },
  })), [visibleEdges]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ComponentFlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges]);

  const persistNodes: OnNodeDrag<ComponentFlowNode> = useCallback((_event, node) => {
    const next: PositionMap = {};
    for (const item of nodes) next[item.id] = { ...item.position };
    next[node.id] = { ...node.position };
    onPositionsChange({ ...positions, ...next });
  }, [nodes, onPositionsChange, positions]);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: ComponentFlowNode) => {
    onSelect(node.id);
  }, [onSelect]);

  return (
    <div className="graph-canvas" role="region" aria-label="Interactive component relationship map">
      <div className="graph-floating-tools">
        <span className="graph-tool-note"><Move3d size={13} /> Drag nodes to arrange</span>
        <button className="graph-tool-button" onClick={() => fitView({ padding: 0.2, duration: 350 })} title="Fit all visible components" aria-label="Fit visible components">
          <Maximize2 size={14} />
        </button>
        {focusNeighbors && <span className="focus-active"><Focus size={12} /> one-hop view</span>}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStop={persistNodes}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.1, minZoom: 0.5 }}
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        aria-label="Application architecture graph"
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={19} size={1} color="#dce3e8" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => componentColor[(node.data as ComponentNodeData).component.layer] ?? "#697888"}
          maskColor="rgba(30, 47, 66, 0.07)"
          className="graph-minimap"
        />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <span className="graph-visible-count"><ArrowDownRight size={12} /> {visibleComponents.length} of {matchingComponents.length} matched shown</span>
    </div>
  );
}
