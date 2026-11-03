import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Cable,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  Layers3,
  Link2,
  Workflow,
} from "lucide-react";
import type { Component, Relationship, Snapshot } from "@modernizer/contracts";

type Props = { component: Component | null; snapshot: Snapshot; onSelect: (id: string) => void };

const relationshipLabels: Record<Relationship["type"], string> = {
  depends_on: "Depends on",
  calls: "Calls",
  reads_writes: "Reads / writes",
  deploys: "Deploys",
  tests: "Tests",
  migrates: "Migrates",
};

export function ComponentDetails({ component, snapshot, onSelect }: Props) {
  if (!component) {
    return (
      <aside className="details-panel details-empty" aria-label="Component details">
        <div className="details-empty-symbol"><Layers3 size={21} /></div>
        <strong>Select an object</strong>
        <span>Choose a node or inventory row to see the associated evidence.</span>
      </aside>
    );
  }

  const relationships = snapshot.relationships.filter(
    (relationship) => relationship.fromId === component.id || relationship.toId === component.id,
  );
  const connections = relationships.map((relationship) => {
    const outgoing = relationship.fromId === component.id;
    const otherId = outgoing ? relationship.toId : relationship.fromId;
    const other = snapshot.components.find((candidate) => candidate.id === otherId);
    return other ? { relationship, other, outgoing } : null;
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const documentation = snapshot.documentation.find((item) => item.componentId === component.id);

  return (
    <aside className="details-panel" aria-label={`${component.name} component details`}>
      <div className="details-head">
        <div className={`details-icon ${component.layer}`}><ComponentGlyph kind={component.kind} /></div>
        <div className="details-title"><span className="details-eyebrow">COMPONENT DETAILS</span><h3>{component.name}</h3><span className={`layer-label ${component.layer}`}>{component.kind.replaceAll("_", " ")}</span></div>
      </div>
      <div className="details-locator"><FileCode2 size={13} /><span title={component.locator}>{component.locator}</span></div>

      <div className="details-divider" />
      <section className="details-section">
        <div className="details-section-title"><Clock3 size={14} /><h4>Version evidence</h4></div>
        {component.versions.length === 0 ? <div className="detail-muted"><CircleHelp size={13} /> No version evidence found</div> : (
          <div className="version-list">{component.versions.map((version, index) => (
            <div className="version-row" key={`${version.facet}-${version.value}-${index}`}><span className={`version-facet ${version.facet}`}>{version.facet}</span><strong>{version.value}</strong><small>{formatDate(version.observedAt)}</small></div>
          ))}</div>
        )}
      </section>

      <section className="details-section">
        <div className="details-section-title"><ActivityIcon /><h4>Observed signals</h4></div>
        <div className="observation-list">{component.observations.map((observation, index) => (
          <div className="observation-row" key={`${observation.dimension}-${index}`}><span>{observation.dimension}</span><span className={`observation-state ${observation.state === "unknown" ? "unknown" : observation.state === "healthy" || observation.state === "passed" || observation.state === "configured" ? "positive" : "neutral"}`}><i />{observation.state.replaceAll("_", " ")}</span></div>
        ))}</div>
      </section>

      <section className="details-section">
        <div className="details-section-title"><Link2 size={14} /><h4>Connections</h4><span className="details-counter">{connections.length}</span></div>
        {connections.length === 0 ? <div className="detail-muted">No connected objects in this snapshot</div> : (
          <div className="connection-list">{connections.map(({ relationship, other, outgoing }) => { const label = relationshipLabels[relationship.type] ?? "Connected"; return <button className="connection-row" key={relationship.id} onClick={() => onSelect(other.id)}><span className={`connection-direction ${outgoing ? "out" : "in"}`}>{outgoing ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}</span><span className="connection-copy"><strong>{other.name}</strong><small>{outgoing ? label : `↳ ${label.toLocaleLowerCase()}`}</small></span><span className="connection-confidence">{relationship.confidence}</span></button>; })}</div>
        )}
      </section>

      <section className="details-section evidence-section">
        <div className="details-section-title"><Code2 size={14} /><h4>Evidence</h4></div>
        <div className="evidence-card-list">{component.evidenceIds.map((evidenceId) => {
          const item = evidence.get(evidenceId);
          return item ? <div className="evidence-card" key={item.id}><span className="evidence-file-icon"><FileCode2 size={13} /></span><span className="evidence-copy"><strong>{item.path ?? item.url ?? item.sourceType}</strong><small>{item.sourceType} · {formatDate(item.observedAt)}</small></span></div> : null;
        })}</div>
      </section>

      <section className="docs-detail-card">
        <div className="docs-detail-icon"><BookOpen size={15} /></div>
        <div><strong>Documentation</strong><span>{documentation?.status ?? "undocumented"}{documentation?.gap ? ` · ${documentation.gap}` : " · No documentation record"}</span></div>
      </section>
      <div className="details-footer"><GitBranch size={13} /> {component.environmentIds.length ? component.environmentIds.map((id) => snapshot.environments.find((environment) => environment.id === id)?.name ?? id).join(", ") : "No environment declared"}</div>
    </aside>
  );
}

function ActivityIcon() {
  return <Workflow size={14} />;
}

function ComponentGlyph({ kind }: { kind: string }) {
  if (kind === "database" || kind === "migration") return <DatabaseIcon />;
  if (kind === "pipeline") return <Workflow size={17} />;
  if (kind === "test_suite") return <span>QA</span>;
  if (kind === "external_service" || kind === "api_endpoint") return <Cable size={17} />;
  if (kind === "package") return <Layers3 size={17} />;
  return <FileCode2 size={17} />;
}

function DatabaseIcon() {
  return <Database size={17} />;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
