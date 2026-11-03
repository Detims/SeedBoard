import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Boxes,
  Cable,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  Database,
  FileCode2,
  Filter,
  GitBranch,
  LayoutDashboard,
  ListFilter,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ArchitectureGraph } from "./components/ArchitectureGraph.js";
import { ComponentDetails } from "./components/ComponentDetails.js";
import type { Component, Snapshot } from "@modernizer/contracts";
import { demoSnapshotSource, type SnapshotSource } from "./snapshotSource.js";
import {
  browserLayoutStore,
  deterministicLayout,
  filterComponents,
  getInventoryCounts,
  type LayerFilter,
  type PositionMap,
} from "./domain.js";

type Page = "overview" | "architecture" | "inventory";
type NavItem = { id: Page; label: string; icon: typeof LayoutDashboard };

const navigation: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "architecture", label: "Architecture map", icon: Workflow },
  { id: "inventory", label: "Component inventory", icon: Boxes },
];

const formatTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "error" };

export function App({ snapshotSource = demoSnapshotSource }: { snapshotSource?: SnapshotSource }) {
  const [snapshotState, setSnapshotState] = useState<SnapshotState>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setSnapshotState({ status: "loading" });
    Promise.resolve().then(() => snapshotSource.loadSnapshot()).then((loaded) => {
      if (active) setSnapshotState({ status: "ready", snapshot: loaded });
    }).catch(() => {
      if (active) setSnapshotState({ status: "error" });
    });
    return () => { active = false; };
  }, [snapshotSource, retry]);

  if (snapshotState.status === "loading") return <SnapshotLoading />;
  if (snapshotState.status === "error") return <SnapshotError onRetry={() => setRetry((value) => value + 1)} />;

  const snapshot = snapshotState.snapshot;
  const [page, setPage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState<LayerFilter>("all");
  const [selectedId, setSelectedId] = useState(snapshot.components[0]?.id ?? null);
  const [focusNeighbors, setFocusNeighbors] = useState(false);
  const [positions, setPositions] = useState<PositionMap>(() => {
    const defaults = deterministicLayout(snapshot.components);
    const saved = browserLayoutStore.load(
      `modernizer:v1:${snapshot.projectId}:${snapshot.id}`,
    );
    return { ...defaults, ...saved };
  });

  const filtered = useMemo(
    () => filterComponents(snapshot.components, query, layer),
    [snapshot.components, query, layer],
  );
  const selected = snapshot.components.find((component) => component.id === selectedId) ?? null;
  const counts = getInventoryCounts(snapshot, filtered.length);
  const layoutKey = `modernizer:v1:${snapshot.projectId}:${snapshot.id}`;

  useEffect(() => {
    browserLayoutStore.save(layoutKey, positions);
  }, [layoutKey, positions]);

  const resetLayout = () => setPositions(deterministicLayout(snapshot.components));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#overview" onClick={() => setPage("overview")}>
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">modernizer</span>
          <span className="brand-build">v0.1</span>
        </a>

        <div className="workspace-switcher">
          <div className="workspace-avatar" aria-hidden="true">M</div>
          <div className="workspace-meta">
            <span className="workspace-name">{snapshot.projectId}</span>
            <span className="workspace-kind">Assessment workspace</span>
          </div>
          <ChevronDown size={15} aria-hidden="true" />
        </div>

        <div className="nav-group-label">WORKSPACE</div>
        <nav className="primary-nav">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${page === id ? "active" : ""}`}
              key={id}
              onClick={() => setPage(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {id === "inventory" && <span className="nav-count">{counts.total}</span>}
            </button>
          ))}
        </nav>

        <div className="nav-group-label second-label">ASSESSMENT</div>
        <div className="nav-item disabled-nav" aria-disabled="true">
          <Sparkles size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>Suggestions</span>
          <span className="nav-count pending-count">6</span>
        </div>
        <div className="nav-item disabled-nav" aria-disabled="true">
          <GitBranch size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>Environments &amp; CI</span>
        </div>
        <div className="nav-item disabled-nav" aria-disabled="true">
          <Database size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>Data &amp; migrations</span>
        </div>
        <div className="nav-item disabled-nav" aria-disabled="true">
          <BookOpen size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>Documentation</span>
        </div>

        <div className="sidebar-spacer" />
        <div className="coverage-card">
          <div className="coverage-title">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Coverage at a glance</span>
          </div>
          <div className="coverage-score">
            <span>{counts.documented + counts.partialDocumentation}</span>
            <span className="coverage-total">/ {counts.total} documented</span>
          </div>
          <div className="coverage-track" aria-label={`${counts.undocumented} components lack documentation`}>
            <span style={{ width: `${counts.total ? ((counts.documented + counts.partialDocumentation) / counts.total) * 100 : 0}%` }} />
          </div>
          <p>{counts.undocumented} components need a documentation review.</p>
        </div>
        <button className="profile-button">
          <span className="profile-avatar">JD</span>
          <span className="profile-name">Local workspace</span>
          <Settings2 size={16} aria-hidden="true" />
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{page === "overview" ? "Overview" : page === "architecture" ? "Architecture" : "Inventory"}</strong>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="Search components"
                placeholder="Search components…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd><Command size={11} aria-label="Command" /> K</kbd>
            </label>
            <span className="demo-pill"><span className="demo-dot" /> DEMO DATA</span>
            <button className="icon-button" aria-label="Help and information" title="Help">
              <CircleHelp size={18} />
            </button>
          </div>
        </header>

        <div className="content-scroll">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> APPLICATION INTELLIGENCE</div>
              <h1>{page === "overview" ? "Your system, at a glance." : page === "architecture" ? "Architecture map" : "Component inventory"}</h1>
              <p>
                {page === "overview"
                  ? "A clear view of what's connected, what's unknown, and where to look next."
                  : page === "architecture"
                    ? "Explore components and the relationships backed by this assessment."
                    : "Search and inspect every object in this snapshot, including collapsed map nodes."}
              </p>
            </div>
            <div className="snapshot-select">
              <span className="snapshot-label">SNAPSHOT</span>
              <span className="snapshot-value"><span className="snapshot-indicator" /> Synthetic example <ChevronDown size={14} /></span>
            </div>
          </div>

          <div className="state-banner demo-banner">
            <div className="banner-symbol"><Activity size={15} /></div>
            <div><strong>Exploring a synthetic snapshot</strong><span>Every signal below is illustrative. No repository has been scanned.</span></div>
            <span className="banner-time">Captured {formatTime.format(new Date(snapshot.capturedAt))}</span>
          </div>

          <section className="metrics-grid" aria-label="Assessment summary">
            <MetricCard label="Architecture objects" value={counts.total} helper="Distinct components" icon={Boxes} tone="blue" trend="Snapshot count" />
            <MetricCard label="Connections" value={counts.relationships} helper="Evidence-backed links" icon={Cable} tone="violet" trend="Across the stack" />
            <MetricCard label="Unknown observations" value={counts.unknownObservations} helper="Health, CI or migrations" icon={CircleHelp} tone="amber" trend="Worth verifying" />
            <MetricCard label="Docs need review" value={counts.undocumented + counts.partialDocumentation} helper={`${counts.undocumented} undocumented · ${counts.partialDocumentation} partial`} icon={BookOpen} tone="rose" trend={`${counts.total ? Math.round(((counts.documented + counts.partialDocumentation) / counts.total) * 100) : 0}% coverage`} />
          </section>

          {page === "inventory" ? (
            <InventoryView
              components={filtered}
              snapshot={snapshot}
              selectedId={selectedId}
              onSelect={setSelectedId}
              layer={layer}
              onLayerChange={setLayer}
              total={counts.total}
            />
          ) : (
            <section className={`architecture-section ${page === "architecture" ? "expanded" : ""}`}>
              <div className="section-header">
                <div>
                  <div className="section-title-row"><h2>{page === "overview" ? "System architecture" : "Explore the map"}</h2><span className="section-count">{counts.total} objects</span></div>
                  <p>{page === "overview" ? "Select any node to see its versions, signals, and evidence." : "Drag to rearrange. Pan or zoom to follow connections."}</p>
                </div>
                <div className="section-actions">
                  <button className={`soft-button ${focusNeighbors ? "selected" : ""}`} onClick={() => setFocusNeighbors((current) => !current)}>
                    <Filter size={14} aria-hidden="true" />
                    {focusNeighbors ? "Showing neighbors" : "Focus neighbors"}
                  </button>
                  <button className="soft-button" onClick={resetLayout} title="Restore the suggested map layout">
                    <ArrowDownRight size={15} aria-hidden="true" /> Reset layout
                  </button>
                  {page === "overview" && <button className="text-link" onClick={() => setPage("architecture")}>Open full map <ArrowRight size={14} /></button>}
                </div>
              </div>
              <div className="map-filter-row">
                <div className="layer-filters" aria-label="Filter map by architecture layer">
                  {(["all", "frontend", "backend", "testing", "data", "delivery", "shared", "external"] as const).map((value) => (
                    <button key={value} className={`filter-chip ${layer === value ? "active" : ""}`} onClick={() => setLayer(value)}>
                      {value === "all" ? "All layers" : value.charAt(0).toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </div>
                <span className="object-count">Showing <strong>{filtered.length}</strong> of {counts.total} objects</span>
              </div>
              <div className="map-and-details">
                <div className="map-card">
                  {filtered.length === 0 ? (
                    <div className="empty-state"><Search size={24} /><strong>No components match those filters</strong><span>Try another name or clear a layer filter.</span><button className="soft-button" onClick={() => { setQuery(""); setLayer("all"); }}>Clear filters</button></div>
                  ) : (
                    <ArchitectureGraph
                      components={snapshot.components}
                      relationships={snapshot.relationships}
                      matchingComponents={filtered}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      positions={positions}
                      onPositionsChange={setPositions}
                      focusNeighbors={focusNeighbors}
                    />
                  )}
                  <div className="map-legend">
                    <span><i className="legend-dot node-front" /> Frontend</span>
                    <span><i className="legend-dot node-back" /> Backend</span>
                    <span><i className="legend-dot node-data" /> Data</span>
                    <span><i className="legend-dot node-external" /> External</span>
                  </div>
                </div>
                <ComponentDetails component={selected} snapshot={snapshot} onSelect={setSelectedId} />
              </div>
            </section>
          )}

          {page === "overview" && (
            <div className="lower-grid">
              <section className="panel-card pipeline-card">
                <div className="panel-header"><div><div className="section-title-row"><h2>Delivery path</h2><span className="mini-status unknown-status">UNKNOWN</span></div><p>Workflow is declared; live run results are not connected.</p></div><Workflow size={19} className="panel-header-icon" /></div>
                <div className="pipeline-track">
                  <PipelineNode icon={FileCode2} name="Source" detail="Git repository" status="declared" />
                  <div className="pipeline-line"><ArrowRight size={14} /></div>
                  <PipelineNode icon={Workflow} name="Workflow" detail="1 declared" status="unknown" />
                  <div className="pipeline-line"><ArrowRight size={14} /></div>
                  <PipelineNode icon={Database} name="Target" detail="Not verified" status="unknown" />
                </div>
                <div className="pipeline-note"><CircleHelp size={14} /> No workflow execution or deployment connection was queried.</div>
              </section>
              <section className="panel-card suggestions-card">
                <div className="panel-header"><div><div className="section-title-row"><h2>Review queue</h2><span className="suggestion-badge">6 examples</span></div><p>Illustrative findings across the six work categories.</p></div><Sparkles size={19} className="panel-header-icon accent-icon" /></div>
                <div className="suggestion-preview-list">
                  <SuggestionPreview category="fix" title="Repair the workflow prerequisite" priority="P1" tone="coral" />
                  <SuggestionPreview category="refactor" title="Review API–worker coupling" priority="P2" tone="violet" />
                  <SuggestionPreview category="docs" title="Document the in-house API" priority="P3" tone="blue" />
                </div>
                <div className="panel-footer-note"><Sparkles size={13} /> Examples only · Rule engine pending T3 validation</div>
              </section>
            </div>
          )}

          <footer className="page-footer"><span>MODERNIZER <span className="footer-separator">/</span> LOCAL ASSESSMENT</span><span><ShieldCheck size={12} /> Read-only demonstration</span></footer>
        </div>
      </main>
    </div>
  );
}

function SnapshotLoading() {
  return <main className="loading-shell" aria-live="polite"><div className="loading-mark"><span /><span /><span /><span /></div><div className="loading-spinner" /><strong>Preparing assessment</strong><span>Loading the selected snapshot…</span></main>;
}

function SnapshotError({ onRetry }: { onRetry: () => void }) {
  return <main className="error-shell"><div className="error-symbol"><CircleHelp size={21} /></div><span className="eyebrow">ASSESSMENT UNAVAILABLE</span><h1>We couldn’t load this snapshot.</h1><p>The source did not return a valid assessment. Check its status and try again.</p><button className="soft-button" onClick={onRetry}><ArrowUpRight size={14} /> Retry snapshot</button></main>;
}

function MetricCard({ label, value, helper, icon: Icon, tone, trend }: {
  label: string; value: number; helper: string; icon: typeof Boxes; tone: string; trend: string;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={17} strokeWidth={1.8} aria-hidden="true" /></div>
      <div className="metric-trend"><span className={`trend-marker ${tone}`}><ArrowUpRight size={12} /></span>{trend}</div>
      <div className="metric-main"><strong>{value}</strong><span>{label}</span></div>
      <div className="metric-helper">{helper}</div>
    </article>
  );
}

function InventoryView({ components, snapshot, selectedId, onSelect, layer, onLayerChange, total }: {
  components: Component[];
  snapshot: Snapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
  layer: LayerFilter;
  onLayerChange: (value: LayerFilter) => void;
  total: number;
}) {
  const documentation = useMemo(
    () => new Map(snapshot.documentation.map((record) => [record.componentId, record.status])),
    [snapshot.documentation],
  );
  const sorted = useMemo(() => [...components].sort((a, b) => a.name.localeCompare(b.name)), [components]);
  return (
    <section className="inventory-section panel-card">
      <div className="inventory-toolbar">
        <div><div className="section-title-row"><h2>All components</h2><span className="section-count">{components.length} / {total}</span></div><p>Exact object totals are independent of map filters and grouping.</p></div>
        <label className="layer-select"><ListFilter size={14} /><span className="sr-only">Filter inventory by layer</span><select value={layer} onChange={(event) => onLayerChange(event.target.value as LayerFilter)}><option value="all">All layers</option>{["frontend", "backend", "testing", "data", "delivery", "shared", "external"].map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select><ChevronDown size={13} /></label>
      </div>
      {sorted.length === 0 ? <div className="empty-state compact-empty"><Search size={23} /><strong>Nothing found</strong><span>Clear your search or choose another layer.</span></div> : (
        <div className="table-wrap"><table className="inventory-table"><thead><tr><th>COMPONENT</th><th>TYPE</th><th>LAYER</th><th>VERSION</th><th>STATUS</th><th>DOCUMENTATION</th><th><span className="sr-only">Open component</span></th></tr></thead><tbody>
          {sorted.map((component) => {
            const version = component.versions.find((item) => item.facet === "resolved") ?? component.versions.find((item) => item.facet === "declared");
            const state = component.observations.find((item) => item.dimension === "health")?.state ?? "not observed";
            const doc = documentation.get(component.id) ?? "undocumented";
            return <tr className={selectedId === component.id ? "selected-row" : ""} key={component.id} onClick={() => onSelect(component.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(component.id); } }}>
              <td><div className="component-cell"><span className={`table-kind-icon ${component.layer}`}><ComponentGlyph kind={component.kind} /></span><span><strong>{component.name}</strong><small>{component.locator}</small></span></div></td>
              <td><span className="plain-type">{component.kind.replaceAll("_", " ")}</span></td>
              <td><span className={`layer-label ${component.layer}`}>{component.layer}</span></td>
              <td><span className="version-label">{version?.value ?? "—"}</span></td>
              <td><StatusPill state={state} /></td>
              <td><DocumentationPill state={doc} /></td>
              <td><button className="row-open" onClick={() => onSelect(component.id)} aria-label={`Inspect ${component.name}`}><ArrowRight size={15} /></button></td>
            </tr>;
          })}
        </tbody></table></div>
      )}
      <div className="inventory-bottom-note"><span><Database size={13} /> Versions stay separated by evidence source.</span><span>Showing {sorted.length} of {total} components</span></div>
    </section>
  );
}

function StatusPill({ state }: { state: string }) {
  const mapped = state === "healthy" || state === "passed" ? "positive" : state === "unhealthy" || state === "failed" ? "negative" : "unknown";
  return <span className={`status-pill ${mapped}`}><i />{state.replaceAll("_", " ")}</span>;
}

function DocumentationPill({ state }: { state: string }) {
  return <span className={`docs-pill ${state}`}><i />{state}</span>;
}

function ComponentGlyph({ kind }: { kind: string }) {
  if (kind === "database" || kind === "migration") return <Database size={15} />;
  if (kind === "pipeline") return <Workflow size={15} />;
  if (kind === "test_suite") return <Check size={15} />;
  if (kind === "external_service" || kind === "api_endpoint") return <Cable size={15} />;
  if (kind === "package") return <Boxes size={15} />;
  return <FileCode2 size={15} />;
}

function PipelineNode({ icon: Icon, name, detail, status }: { icon: typeof Database; name: string; detail: string; status: string }) {
  return <div className={`pipeline-node ${status}`}><span className="pipeline-node-icon"><Icon size={15} /></span><strong>{name}</strong><small>{detail}</small></div>;
}

function SuggestionPreview({ category, title, priority, tone }: { category: string; title: string; priority: string; tone: string }) {
  return <div className="suggestion-preview-row"><span className={`category-mark ${tone}`}>{category.slice(0, 1)}</span><span className="suggestion-copy"><strong>{title}</strong><small>{category} <i /> synthetic evidence</small></span><span className={`priority-pill ${priority.toLowerCase()}`}>{priority}</span></div>;
}
