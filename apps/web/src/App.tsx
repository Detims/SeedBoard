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
  Moon,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Workflow,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArchitectureGraph } from "./components/ArchitectureGraph.js";
import { ComponentDetails } from "./components/ComponentDetails.js";
import { PackageAdvisories } from "./components/PackageAdvisories.js";
import { QualityCoverage } from "./components/QualityCoverage.js";
import type { Component, Snapshot, Suggestion } from "@modernizer/contracts";
import {
  demoSnapshotSource,
  type ProjectSummary,
  type RepositoryChanges,
  type SnapshotSource,
} from "./snapshotSource.js";
import { LocalApiError } from "./apiSnapshotSource.js";
import {
  applyTheme,
  getInitialTheme,
  getSavedThemePreference,
  getSystemTheme,
  saveTheme,
  type Theme,
} from "./theme.js";
import {
  filterDocumentationComponents,
  filterSuggestionsByCategory,
  type SuggestionCategoryFilter,
} from "./viewFilters.js";
import {
  browserLayoutStore,
  deterministicLayout,
  filterComponents,
  filterOverviewArchitectureComponents,
  getInventoryCounts,
  type LayerFilter,
  type PositionMap,
} from "./domain.js";

type Page =
  | "overview"
  | "architecture"
  | "inventory"
  | "suggestions"
  | "environments"
  | "quality"
  | "data"
  | "documentation"
  | "comparison";
type NavItem = { id: Page; label: string; icon: typeof LayoutDashboard };

const navigation: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "architecture", label: "Architecture map", icon: Workflow },
  { id: "inventory", label: "Component inventory", icon: Boxes },
  { id: "suggestions", label: "Suggestions", icon: Sparkles },
  { id: "environments", label: "Environments & CI", icon: GitBranch },
  { id: "quality", label: "Coverage & risks", icon: Activity },
  { id: "data", label: "Data & migrations", icon: Database },
  { id: "documentation", label: "Documentation", icon: BookOpen },
  { id: "comparison", label: "Snapshot comparison", icon: GitBranch },
];

const formatTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "error"; message: string; code: string };

export function App({ snapshotSource = demoSnapshotSource }: { snapshotSource?: SnapshotSource }) {
  const [snapshotState, setSnapshotState] = useState<SnapshotState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [scanNotice, setScanNotice] = useState("");
  const [addProjectOpen, setAddProjectOpen] = useState(false);

  const registerProject = async (input: { rootPath: string; name?: string }) => {
    if (!snapshotSource.registerProject) {
      throw new Error("Project registration is available when using the local API.");
    }
    await snapshotSource.registerProject(input);
    setAddProjectOpen(false);
    setSnapshotState({ status: "loading" });
    setRetry((value) => value + 1);
  };

  const selectProject = async (projectId: string) => {
    if (!snapshotSource.selectProject) return;
    setScanNotice("");
    setSnapshotState({ status: "loading" });
    try {
      setSnapshotState({
        status: "ready",
        snapshot: await snapshotSource.selectProject(projectId),
      });
    } catch (error) {
      setSnapshotState({
        status: "error",
        message:
          error instanceof Error ? error.message : "The selected project could not be loaded.",
        code: error instanceof LocalApiError ? error.code : "PROJECT_LOAD_FAILED",
      });
    }
  };

  const removeProject = async (projectId: string) => {
    if (!snapshotSource.removeProject) return;
    const wasSelected =
      snapshotState.status === "ready" && snapshotState.snapshot.projectId === projectId;
    await snapshotSource.removeProject(projectId);
    if (wasSelected) {
      setSnapshotState({ status: "loading" });
      try {
        setSnapshotState({ status: "ready", snapshot: await snapshotSource.loadSnapshot() });
      } catch (error) {
        setSnapshotState({
          status: "error",
          message: error instanceof Error ? error.message : "No project could be loaded.",
          code: error instanceof LocalApiError ? error.code : "PROJECTS_EMPTY",
        });
      }
    }
  };

  const selectSnapshot = async (snapshotId: string) => {
    if (!snapshotSource.loadSnapshotById) return;
    try {
      setSnapshotState({
        status: "ready",
        snapshot: await snapshotSource.loadSnapshotById(snapshotId),
      });
      setScanNotice("");
    } catch (error) {
      setScanNotice(error instanceof Error ? error.message : "The snapshot could not be loaded.");
    }
  };

  useEffect(() => {
    let active = true;
    setSnapshotState({ status: "loading" });
    Promise.resolve()
      .then(() => snapshotSource.loadSnapshot())
      .then((loaded) => {
        if (active) setSnapshotState({ status: "ready", snapshot: loaded });
      })
      .catch((error: unknown) => {
        if (active)
          setSnapshotState({
            status: "error",
            message:
              error instanceof Error ? error.message : "The local assessment could not be loaded.",
            code: error instanceof LocalApiError ? error.code : "LOAD_FAILED",
          });
      });
    return () => {
      active = false;
    };
  }, [snapshotSource, retry]);

  if (snapshotState.status === "loading") return <SnapshotLoading />;
  if (snapshotState.status === "error")
    return (
      <>
        <SnapshotError
          message={snapshotState.message}
          code={snapshotState.code}
          onRetry={() => setRetry((value) => value + 1)}
          onAddProject={snapshotSource.registerProject ? () => setAddProjectOpen(true) : undefined}
          onScan={
            snapshotSource.scanLatest
              ? async () => {
                  setSnapshotState({ status: "loading" });
                  try {
                    setSnapshotState({
                      status: "ready",
                      snapshot: await snapshotSource.scanLatest!(),
                    });
                  } catch (error) {
                    setSnapshotState({
                      status: "error",
                      message: error instanceof Error ? error.message : "The scan failed.",
                      code: error instanceof LocalApiError ? error.code : "SCAN_FAILED",
                    });
                  }
                }
              : undefined
          }
        />
        {addProjectOpen && (
          <AddProjectDialog onClose={() => setAddProjectOpen(false)} onRegister={registerProject} />
        )}
      </>
    );
  const snapshot = snapshotState.snapshot;
  return (
    <LoadedDashboard
      snapshot={snapshot}
      snapshotSource={snapshotSource}
      scanNotice={scanNotice}
      onDismissScanNotice={() => setScanNotice("")}
      onSelectProject={(projectId) => void selectProject(projectId)}
      onRemoveProject={removeProject}
      onSelectSnapshot={selectSnapshot}
      onOpenAddProject={snapshotSource.registerProject ? () => setAddProjectOpen(true) : undefined}
      addProjectOpen={addProjectOpen}
      onCloseAddProject={() => setAddProjectOpen(false)}
      onRegisterProject={registerProject}
      onScan={async () => {
        if (!snapshotSource.scanLatest) return;
        setScanNotice(
          "Scan running. The current snapshot stays available until a new one passes validation.",
        );
        try {
          setSnapshotState({ status: "ready", snapshot: await snapshotSource.scanLatest() });
          setScanNotice("New snapshot published successfully.");
        } catch (error) {
          setScanNotice(
            error instanceof Error
              ? error.message
              : "The scan failed. The previous snapshot remains available.",
          );
        }
      }}
    />
  );
}

function LoadedDashboard({
  snapshot,
  snapshotSource,
  scanNotice,
  onDismissScanNotice,
  onSelectProject,
  onRemoveProject,
  onSelectSnapshot,
  onScan,
  onOpenAddProject,
  addProjectOpen,
  onCloseAddProject,
  onRegisterProject,
}: {
  snapshot: Snapshot;
  snapshotSource: SnapshotSource;
  scanNotice: string;
  onDismissScanNotice: () => void;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => Promise<void>;
  onSelectSnapshot: (snapshotId: string) => Promise<void>;
  onScan: () => void;
  onOpenAddProject?: (() => void) | undefined;
  addProjectOpen: boolean;
  onCloseAddProject: () => void;
  onRegisterProject: (input: { rootPath: string; name?: string }) => Promise<void>;
}) {
  const [themePreference, setThemePreference] = useState<Theme | null>(getSavedThemePreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme);
  const theme = themePreference ?? systemTheme;
  const [page, setPage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState<LayerFilter>("all");
  const [selectedId, setSelectedId] = useState(snapshot.components[0]?.id ?? null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusNeighbors, setFocusNeighbors] = useState(false);
  const [positions, setPositions] = useState<PositionMap>(() => {
    const defaults = deterministicLayout(snapshot.components);
    const saved = browserLayoutStore.load(`modernizer:v1:${snapshot.projectId}:${snapshot.id}`);
    return { ...defaults, ...saved };
  });

  const filtered = useMemo(
    () => filterComponents(snapshot.components, query, layer),
    [snapshot.components, query, layer],
  );
  const overviewArchitecture = useMemo(
    () => filterOverviewArchitectureComponents(filterComponents(snapshot.components, query, "all")),
    [snapshot.components, query],
  );
  const selected = snapshot.components.find((component) => component.id === selectedId) ?? null;
  const selectedProjectName = snapshotSource.getSelectedProject?.()?.name ?? snapshot.projectId;
  const counts = getInventoryCounts(snapshot, filtered.length);
  const layoutKey = `modernizer:v1:${snapshot.projectId}:${snapshot.id}`;

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const updateSystemTheme = (event: MediaQueryListEvent) => {
        setSystemTheme(event.matches ? "dark" : "light");
      };
      media.addEventListener("change", updateSystemTheme);
      return () => media.removeEventListener("change", updateSystemTheme);
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    browserLayoutStore.save(layoutKey, positions);
  }, [layoutKey, positions]);

  useEffect(() => {
    let active = true;
    snapshotSource
      .loadLayout?.(snapshot.projectId)
      .then((saved) => {
        if (active && saved) setPositions((current) => ({ ...current, ...saved }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [snapshot.projectId, snapshotSource]);

  useEffect(() => {
    if (snapshot.demo) return;
    snapshotSource
      .saveLayout?.(snapshot.projectId, "architecture", positions)
      .catch(() => undefined);
  }, [positions, snapshot.demo, snapshot.projectId, snapshotSource]);

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
          <span className="brand-word">SeedBoard</span>
          <span className="brand-build">v0.1</span>
        </a>

        <div className="nav-group-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Workspace">
          {navigation.slice(0, 3).map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${page === id ? "active" : ""}`}
              key={id}
              onClick={() => setPage(id)}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {id === "inventory" && <span className="nav-count">{counts.total}</span>}
            </button>
          ))}
        </nav>

        <div className="nav-group-label second-label">ASSESSMENT</div>
        <nav className="primary-nav" aria-label="Assessment views">
          {navigation.slice(3).map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${page === id ? "active" : ""}`}
              key={id}
              onClick={() => setPage(id)}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {id === "suggestions" && (
                <span className="nav-count">{snapshot.suggestions.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <WorkspaceSwitcher
          snapshot={snapshot}
          source={snapshotSource}
          onSelectProject={onSelectProject}
          onRemoveProject={onRemoveProject}
        />
        <div className="coverage-card">
          <div className="coverage-title">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Coverage at a glance</span>
          </div>
          <div className="coverage-score">
            <span>{counts.documented + counts.partialDocumentation}</span>
            <span className="coverage-total">/ {counts.total} documented</span>
          </div>
          <div
            className="coverage-track"
            aria-label={`${counts.undocumented} components lack documentation`}
          >
            <span
              style={{
                width: `${counts.total ? ((counts.documented + counts.partialDocumentation) / counts.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p>{counts.undocumented} components need a documentation review.</p>
        </div>
        <div className="account-menu-wrap">
          <button
            className="profile-button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
          >
            <span className="profile-avatar">L</span>
            <span className="profile-name">Local access</span>
            <Settings2 size={16} aria-hidden="true" />
          </button>
          {accountOpen && (
            <div className="account-menu" role="menu" aria-label="Local account">
              <div className="account-menu-status">
                <strong>Local access</strong>
                <span>No account is connected</span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings2 size={14} aria-hidden="true" /> Settings
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{pageTitle(page)}</strong>
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
              <kbd>
                <Command size={11} aria-label="Command" /> K
              </kbd>
            </label>
            {onOpenAddProject && (
              <button className="soft-button add-project-button" onClick={onOpenAddProject}>
                <Plus size={15} aria-hidden="true" /> Add project
              </button>
            )}
            {snapshot.demo ? (
              <span className="demo-pill">
                <span className="demo-dot" /> DEMO DATA
              </span>
            ) : (
              <button className="soft-button scan-button" onClick={onScan}>
                Run scan
              </button>
            )}
            <button
              className="icon-button theme-toggle"
              type="button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-pressed={theme === "dark"}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={() => {
                const nextTheme = theme === "dark" ? "light" : "dark";
                saveTheme(nextTheme);
                setThemePreference(nextTheme);
              }}
            >
              {theme === "dark" ? (
                <Sun size={17} aria-hidden="true" />
              ) : (
                <Moon size={17} aria-hidden="true" />
              )}
            </button>
            <button className="icon-button" aria-label="Help and information" title="Help">
              <CircleHelp size={18} />
            </button>
          </div>
        </header>

        <div className="content-scroll">
          {scanNotice && (
            <DismissibleNotice
              message={scanNotice}
              dismissLabel="Dismiss scan notification"
              onDismiss={onDismissScanNotice}
            />
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" /> APPLICATION INTELLIGENCE
              </div>
              <h1>{page === "overview" ? "Your system, at a glance." : pageTitle(page)}</h1>
              <p>
                {page === "overview"
                  ? "A clear view of what's connected, what's unknown, and where to look next."
                  : page === "architecture"
                    ? "Explore components and the relationships backed by this assessment."
                    : page === "inventory"
                      ? "Search and inspect every object in this snapshot, including collapsed map nodes."
                      : page === "suggestions"
                        ? "Review evidence-backed modernization suggestions before making any changes."
                        : page === "environments"
                          ? "Inspect declared environments, test gates, workflows, and known unknowns."
                          : page === "quality"
                            ? "Review test and deployment mappings, plus components that need closer attention."
                            : page === "data"
                              ? "Review database components and migration files without implying applied state."
                              : page === "documentation"
                                ? "Review official references, internal guides, and explicit documentation gaps."
                                : "Compare immutable snapshots to see added, removed, and changed objects."}
              </p>
            </div>
            <SnapshotPicker
              snapshot={snapshot}
              source={snapshotSource}
              onSelectSnapshot={onSelectSnapshot}
            />
          </div>

          {snapshot.demo && (
            <div className="state-banner demo-banner">
              <div className="banner-symbol">
                <Activity size={15} />
              </div>
              <div>
                <strong>Exploring a synthetic snapshot</strong>
                <span>Every signal below is illustrative. No repository has been scanned.</span>
              </div>
              <span className="banner-time">
                Captured {formatTime.format(new Date(snapshot.capturedAt))}
              </span>
            </div>
          )}

          {page !== "architecture" && (
            <section className="metrics-grid" aria-label="Assessment summary">
              <MetricCard
                label="Architecture objects"
                value={counts.total}
                helper="Distinct components"
                icon={Boxes}
                tone="blue"
                trend="Snapshot count"
                destination="Component inventory"
                onClick={() => setPage("inventory")}
              />
              <MetricCard
                label="Connections"
                value={counts.relationships}
                helper="Evidence-backed links"
                icon={Cable}
                tone="violet"
                trend="Across the stack"
                destination="Architecture map"
                onClick={() => setPage("architecture")}
              />
              <MetricCard
                label="Unknown observations"
                value={counts.unknownObservations}
                helper="Health, CI or migrations"
                icon={CircleHelp}
                tone="amber"
                trend="Worth verifying"
                destination="Component inventory"
                onClick={() => setPage("inventory")}
              />
              <MetricCard
                label="Docs need review"
                value={counts.undocumented + counts.partialDocumentation}
                helper={`${counts.undocumented} undocumented · ${counts.partialDocumentation} partial`}
                icon={BookOpen}
                tone="rose"
                trend={`${counts.total ? Math.round(((counts.documented + counts.partialDocumentation) / counts.total) * 100) : 0}% coverage`}
                destination="Documentation"
                onClick={() => setPage("documentation")}
              />
            </section>
          )}

          {page === "inventory" ? (
            <InventoryView
              components={filtered}
              snapshot={snapshot}
              source={snapshotSource}
              selectedId={selectedId}
              onSelect={setSelectedId}
              layer={layer}
              onLayerChange={setLayer}
              total={counts.total}
            />
          ) : page === "overview" || page === "architecture" ? (
            <section
              className={`architecture-section ${page === "overview" ? "preview" : "expanded"}`}
            >
              <div className="section-header">
                <div>
                  <div className="section-title-row">
                    <h2>{page === "overview" ? "Core architecture" : "Explore the map"}</h2>
                    <span className="section-count">{counts.total} objects</span>
                  </div>
                  <p>
                    {page === "overview"
                      ? "A focused view of the frontend, backend, data, and delivery layers."
                      : "Drag to rearrange. Pan or zoom to follow connections."}
                  </p>
                </div>
                <div className="section-actions">
                  {page === "architecture" && (
                    <>
                      <button
                        className={`soft-button ${focusNeighbors ? "selected" : ""}`}
                        onClick={() => setFocusNeighbors((current) => !current)}
                      >
                        <Filter size={14} aria-hidden="true" />
                        {focusNeighbors ? "Showing neighbors" : "Focus neighbors"}
                      </button>
                      <button
                        className="soft-button"
                        onClick={resetLayout}
                        title="Restore the suggested map layout"
                      >
                        <ArrowDownRight size={15} aria-hidden="true" /> Reset layout
                      </button>
                    </>
                  )}
                  {page === "overview" && (
                    <button className="text-link" onClick={() => setPage("architecture")}>
                      Open full map <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
              {page === "architecture" && (
                <div className="map-filter-row">
                  <div className="layer-filters" aria-label="Filter map by architecture layer">
                    {(
                      [
                        "all",
                        "frontend",
                        "backend",
                        "testing",
                        "data",
                        "delivery",
                        "shared",
                        "external",
                      ] as const
                    ).map((value) => (
                      <button
                        key={value}
                        className={`filter-chip ${layer === value ? "active" : ""}`}
                        onClick={() => setLayer(value)}
                      >
                        {value === "all"
                          ? "All layers"
                          : value.charAt(0).toUpperCase() + value.slice(1)}
                      </button>
                    ))}
                  </div>
                  <span className="object-count">
                    Showing <strong>{filtered.length}</strong> of {counts.total} objects
                  </span>
                </div>
              )}
              <div className="map-and-details">
                <div className="map-card">
                  {(page === "overview" ? overviewArchitecture : filtered).length === 0 ? (
                    <div className="empty-state">
                      <Search size={24} />
                      <strong>No components match those filters</strong>
                      <span>Try another name or clear a layer filter.</span>
                      <button
                        className="soft-button"
                        onClick={() => {
                          setQuery("");
                          setLayer("all");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : (
                    <ArchitectureGraph
                      components={page === "overview" ? overviewArchitecture : snapshot.components}
                      relationships={snapshot.relationships}
                      matchingComponents={page === "overview" ? overviewArchitecture : filtered}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      positions={positions}
                      onPositionsChange={setPositions}
                      focusNeighbors={focusNeighbors}
                    />
                  )}
                  <div className="map-legend">
                    <span>
                      <i className="legend-dot node-front" /> Frontend
                    </span>
                    <span>
                      <i className="legend-dot node-back" /> Backend
                    </span>
                    <span>
                      <i className="legend-dot node-data" /> Data
                    </span>
                    <span>
                      <i className="legend-dot node-external" /> External
                    </span>
                  </div>
                </div>
                {page === "architecture" && (
                  <ComponentDetails
                    component={selected}
                    snapshot={snapshot}
                    onSelect={setSelectedId}
                  />
                )}
              </div>
            </section>
          ) : page === "quality" ? (
            <QualityCoverage
              snapshot={snapshot}
              onInspectComponent={(componentId) => {
                setSelectedId(componentId);
                setPage("inventory");
              }}
            />
          ) : (
            <AssessmentView page={page} snapshot={snapshot} source={snapshotSource} />
          )}

          {page === "overview" && (
            <div className="lower-grid">
              <section className="panel-card pipeline-card">
                <div className="panel-header">
                  <div>
                    <div className="section-title-row">
                      <h2>Delivery path</h2>
                      <span className="mini-status unknown-status">DECLARED</span>
                    </div>
                    <p>Workflow and test components are shown from collected repository files.</p>
                  </div>
                  <Workflow size={19} className="panel-header-icon" />
                </div>
                <div className="pipeline-track">
                  <PipelineNode
                    icon={FileCode2}
                    name="Source"
                    detail="Git repository"
                    status="declared"
                  />
                  <div className="pipeline-line">
                    <ArrowRight size={14} />
                  </div>
                  <PipelineNode
                    icon={Workflow}
                    name="Workflow"
                    detail={`${snapshot.components.filter((item) => item.kind === "pipeline").length} declared`}
                    status="unknown"
                  />
                  <div className="pipeline-line">
                    <ArrowRight size={14} />
                  </div>
                  <PipelineNode
                    icon={Database}
                    name="Target"
                    detail="Not verified"
                    status="unknown"
                  />
                </div>
                <div className="pipeline-note">
                  <CircleHelp size={14} /> No workflow execution or deployment connection was
                  queried.
                </div>
              </section>
              <section className="panel-card suggestions-card">
                <div className="panel-header">
                  <div>
                    <div className="section-title-row">
                      <h2>Review queue</h2>
                      <span className="suggestion-badge">
                        {snapshot.suggestions.length} suggestions
                      </span>
                    </div>
                    <p>Evidence-backed proposals for owner review.</p>
                  </div>
                  <Sparkles size={19} className="panel-header-icon accent-icon" />
                </div>
                <div className="suggestion-preview-list">
                  {snapshot.suggestions.slice(0, 3).map((item) => (
                    <SuggestionPreview
                      key={item.id}
                      category={item.category}
                      title={item.title}
                      priority={item.priority}
                      tone="blue"
                    />
                  ))}
                  {snapshot.suggestions.length === 0 && (
                    <div className="detail-muted">
                      No suggestions met their evidence requirements.
                    </div>
                  )}
                </div>
                <div className="panel-footer-note">
                  <Sparkles size={13} /> Suggestions are review-only and never auto-applied.
                </div>
              </section>
            </div>
          )}

          <footer className="page-footer">
            <span>
              SEEDBOARD <span className="footer-separator">/</span> LOCAL ASSESSMENT
            </span>
            <span>
              <ShieldCheck size={12} />{" "}
              {snapshot.demo ? "Synthetic demo" : "Read-only repository scan"}
            </span>
          </footer>
        </div>
      </main>
      {addProjectOpen && (
        <AddProjectDialog onClose={onCloseAddProject} onRegister={onRegisterProject} />
      )}
      {settingsOpen && (
        <SettingsDialog
          projectName={selectedProjectName}
          canAddProject={Boolean(onOpenAddProject)}
          onClose={() => setSettingsOpen(false)}
          onAddProject={() => {
            setSettingsOpen(false);
            onOpenAddProject?.();
          }}
        />
      )}
    </div>
  );
}

function SettingsDialog({
  projectName,
  canAddProject,
  onClose,
  onAddProject,
}: {
  projectName: string;
  canAddProject: boolean;
  onClose: () => void;
  onAddProject: () => void;
}) {
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="add-project-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">LOCAL CONFIGURATION</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="settings-list">
          <div>
            <strong>Access</strong>
            <span>Local only. Sign-in is not configured for this installation.</span>
          </div>
          <div>
            <strong>Selected project</strong>
            <span>{projectName}</span>
          </div>
        </div>
        {canAddProject && (
          <button className="soft-button" type="button" onClick={onAddProject}>
            <Plus size={14} aria-hidden="true" /> Add project
          </button>
        )}
      </section>
    </div>
  );
}

function DismissibleNotice({
  message,
  dismissLabel,
  onDismiss,
}: {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div className="action-notice" role="status" aria-live="polite" aria-atomic="true">
      <span className="action-notice-message">{message}</span>
      <button
        className="notice-dismiss"
        type="button"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={onDismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function WorkspaceSwitcher({
  snapshot,
  source,
  onSelectProject,
  onRemoveProject,
}: {
  snapshot: Snapshot;
  source: SnapshotSource;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>(() => {
    const selected = source.getSelectedProject?.();
    return selected ? [selected] : [];
  });
  const [projectsLoaded, setProjectsLoaded] = useState(() =>
    Boolean(source.getSelectedProject?.()),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const canSwitchProjects = !snapshot.demo && Boolean(source.listProjects && source.selectProject);
  const selectedProject = source.getSelectedProject?.();
  const activeProject =
    projects.find((project) => project.id === snapshot.projectId) ??
    (selectedProject?.id === snapshot.projectId ? selectedProject : undefined);
  const projectName =
    activeProject?.name ?? (projectsLoaded ? snapshot.projectId : "Loading project…");

  const refreshProjects = useCallback(async () => {
    if (!source.listProjects) return;
    setLoading(true);
    setError("");
    try {
      setProjects(await source.listProjects());
      setProjectsLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load local projects.");
      setProjectsLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  if (!canSwitchProjects) {
    return (
      <div className="workspace-switcher workspace-switcher-static" aria-label="Demo workspace">
        <div className="workspace-avatar" aria-hidden="true">
          D
        </div>
        <div className="workspace-meta">
          <span className="workspace-name">Synthetic example</span>
          <span className="workspace-kind">Project switching is unavailable in demo mode</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="workspace-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        className="workspace-switcher"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current project: ${projectName}. Switch project`}
        onClick={() => {
          const shouldOpen = !open;
          setOpen(shouldOpen);
          if (shouldOpen) void refreshProjects();
        }}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {projectName.charAt(0).toUpperCase() || "S"}
        </span>
        <span className="workspace-meta">
          <span className="workspace-name">{projectName}</span>
          <span className="workspace-kind">Switch project</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="workspace-menu" role="menu" aria-label="Switch project">
          {loading ? (
            <span className="workspace-menu-status" role="status">
              Loading projects…
            </span>
          ) : error ? (
            <div className="workspace-menu-error" role="status">
              <span>{error}</span>
              <button
                className="workspace-menu-retry"
                type="button"
                onClick={() => void refreshProjects()}
              >
                Retry
              </button>
            </div>
          ) : projects.length === 0 ? (
            <span className="workspace-menu-status" role="status">
              No registered projects are available.
            </span>
          ) : (
            projects.map((project) => {
              const selected = project.id === snapshot.projectId;
              return (
                <div className="workspace-option-row" key={project.id}>
                  <button
                    className={`workspace-option ${selected ? "selected" : ""}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      setOpen(false);
                      if (!selected) onSelectProject(project.id);
                    }}
                  >
                    <span className="workspace-option-copy">
                      <span className="workspace-option-name">{project.name}</span>
                      <span className="workspace-option-id">{project.id}</span>
                    </span>
                    {selected && <Check size={15} aria-hidden="true" />}
                  </button>
                  {source.removeProject && (
                    <button
                      className="workspace-option-remove"
                      type="button"
                      aria-label={`Remove ${project.name} from SeedBoard`}
                      title={`Remove ${project.name} from SeedBoard`}
                      onClick={async () => {
                        const confirmed = window.confirm(
                          `Remove “${project.name}” from SeedBoard? Its scans, snapshots, layouts, and suggestion decisions will be deleted. The project folder and its files will remain untouched.`,
                        );
                        if (!confirmed) return;
                        setError("");
                        setLoading(true);
                        try {
                          await onRemoveProject(project.id);
                          await refreshProjects();
                          if (projects.length <= 1) setOpen(false);
                        } catch (caught) {
                          setError(
                            caught instanceof Error ? caught.message : "Could not remove project.",
                          );
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function SnapshotPicker({
  snapshot,
  source,
  onSelectSnapshot,
}: {
  snapshot: Snapshot;
  source: SnapshotSource;
  onSelectSnapshot: (snapshotId: string) => Promise<void>;
}) {
  const [history, setHistory] = useState<
    Array<{
      id: string;
      capturedAt: string;
      assessmentStatus: string;
      componentCount: number;
      relationshipCount: number;
    }>
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    if (snapshot.demo || !source.listHistory) {
      setHistory([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    source
      .listHistory(snapshot.projectId)
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Snapshot history is unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [snapshot.demo, snapshot.id, snapshot.projectId, source]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const options = history.some((item) => item.id === snapshot.id)
    ? history
    : [
        {
          id: snapshot.id,
          capturedAt: snapshot.capturedAt,
          assessmentStatus: "current",
          componentCount: snapshot.components.length,
          relationshipCount: snapshot.relationships.length,
        },
        ...history,
      ];

  const selectedSnapshotLabel = snapshot.demo
    ? "Synthetic example"
    : `${formatTime.format(new Date(snapshot.capturedAt))} · ${snapshot.components.length} objects`;

  return (
    <div
      ref={pickerRef}
      className="snapshot-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        className="snapshot-select"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Selected snapshot: ${selectedSnapshotLabel}. Choose snapshot`}
        disabled={
          snapshot.demo || !source.loadSnapshotById || loading || selecting || options.length < 2
        }
        onClick={() => setOpen((current) => !current)}
      >
        <span className="snapshot-label">SNAPSHOT</span>
        <span className="snapshot-value">
          <span className="snapshot-indicator" />
          <span className="snapshot-current-value">
            {selecting ? "Loading snapshot…" : selectedSnapshotLabel}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="snapshot-menu" role="menu" aria-label="Choose a snapshot">
          {options.map((item) => {
            const selected = item.id === snapshot.id;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`snapshot-option ${selected ? "selected" : ""}`}
                disabled={selecting}
                onClick={() => {
                  setOpen(false);
                  if (selected) return;
                  setSelecting(true);
                  void onSelectSnapshot(item.id).finally(() => setSelecting(false));
                }}
              >
                <span className="snapshot-option-copy">
                  <span className="snapshot-option-name">
                    {formatTime.format(new Date(item.capturedAt))}
                  </span>
                  <span className="snapshot-option-meta">
                    {item.componentCount} objects · {item.relationshipCount} relationships
                  </span>
                </span>
                {selected && <Check size={15} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <span className="snapshot-history-error" role="status">
          {error}
        </span>
      )}
    </div>
  );
}

function AddProjectDialog({
  onClose,
  onRegister,
}: {
  onClose: () => void;
  onRegister: (input: { rootPath: string; name?: string }) => Promise<void>;
}) {
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!rootPath.trim()) {
      setError("Enter the full folder path on the machine running SeedBoard.");
      return;
    }
    setSubmitting(true);
    try {
      const trimmedName = name.trim();
      await onRegister({
        rootPath: rootPath.trim(),
        ...(trimmedName ? { name: trimmedName } : {}),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project could not be registered.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="add-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">LOCAL REPOSITORY</span>
            <h2 id="add-project-title">Add a project</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close add project dialog"
            onClick={onClose}
            disabled={submitting}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="dialog-description">
          Enter a folder path on the computer running SeedBoard. SeedBoard reads it locally and
          keeps the path private.
        </p>
        <form className="add-project-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="project-root-path">Project folder path</label>
          <input
            id="project-root-path"
            autoFocus
            required
            maxLength={4096}
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            placeholder="C:/Users/you/source/my-app or /home/you/my-app"
          />
          <p className="field-help">Use an existing folder path, not a GitHub URL.</p>
          <label htmlFor="project-display-name">
            Display name <span>(optional)</span>
          </label>
          <input
            id="project-display-name"
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Defaults to the folder name"
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="soft-button" type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button className="soft-button selected" type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add project"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SnapshotLoading() {
  return (
    <main className="loading-shell" aria-live="polite">
      <div className="loading-mark">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="loading-spinner" />
      <strong>Preparing assessment</strong>
      <span>Loading the selected snapshot…</span>
    </main>
  );
}

function SnapshotError({
  message,
  code,
  onRetry,
  onScan,
  onAddProject,
}: {
  message: string;
  code: string;
  onRetry: () => void;
  onScan?: (() => void) | undefined;
  onAddProject?: (() => void) | undefined;
}) {
  return (
    <main className="error-shell">
      <div className="error-symbol">
        <CircleHelp size={21} />
      </div>
      <span className="eyebrow">ASSESSMENT UNAVAILABLE</span>
      <h1>
        {code === "PROJECTS_EMPTY"
          ? "Register a repository to begin."
          : code === "SNAPSHOT_EMPTY"
            ? "Your first scan is ready."
            : "We couldn’t load this snapshot."}
      </h1>
      <p>{message}</p>
      <div className="error-actions">
        {onScan && code === "SNAPSHOT_EMPTY" && (
          <button className="soft-button" onClick={onScan}>
            <Workflow size={14} /> Run first scan
          </button>
        )}
        <button className="soft-button" onClick={onRetry}>
          <ArrowUpRight size={14} /> Retry snapshot
        </button>
        {code === "PROJECTS_EMPTY" &&
          (onAddProject ? (
            <button className="soft-button" onClick={onAddProject}>
              <Plus size={14} aria-hidden="true" /> Add project
            </button>
          ) : (
            <span className="error-command">seedboard project register &lt;folder&gt;</span>
          ))}
      </div>
    </main>
  );
}

function pageTitle(page: Page): string {
  return {
    overview: "Overview",
    architecture: "Architecture map",
    inventory: "Component inventory",
    suggestions: "Suggestions",
    environments: "Environments & CI",
    quality: "Coverage & risks",
    data: "Data & migrations",
    documentation: "Documentation",
    comparison: "Snapshot comparison",
  }[page];
}

function AssessmentView({
  page,
  snapshot,
  source,
}: {
  page: Page;
  snapshot: Snapshot;
  source: SnapshotSource;
}) {
  const [suggestionCategory, setSuggestionCategory] = useState<SuggestionCategoryFilter>("all");
  const [documentationQuery, setDocumentationQuery] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const categories = ["feat", "chore", "refactor", "style", "fix", "docs"] as const;
  const suggestions = filterSuggestionsByCategory(snapshot.suggestions, suggestionCategory);
  const download = async (format: "json" | "backlog" | "appendix") => {
    try {
      if (!source.exportSnapshot) throw new Error("Exports are available for local API snapshots.");
      const blob = await source.exportSnapshot(snapshot.id, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `seedboard-${format}.${format === "json" ? "json" : "md"}`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`${format} export downloaded.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed.");
    }
  };
  const decide = async (suggestion: Suggestion, state: "accepted" | "dismissed") => {
    try {
      if (!source.saveDecision)
        throw new Error("Decision persistence is available for local API snapshots.");
      if (state === "dismissed" && !reason.trim()) {
        setNotice("Add a short reason before dismissing this suggestion.");
        return;
      }
      setWorkingId(suggestion.fingerprint);
      await source.saveDecision(
        snapshot.projectId,
        suggestion.fingerprint,
        state,
        state === "dismissed" ? reason.trim() : "",
      );
      setReason("");
      setNotice(`Suggestion marked ${state}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the decision.");
    } finally {
      setWorkingId(null);
    }
  };
  const downloads = (
    <div className="export-actions">
      <button className="soft-button" onClick={() => void download("appendix")}>
        Export appendix
      </button>
      <button className="soft-button" onClick={() => void download("backlog")}>
        Export backlog
      </button>
      <button className="soft-button" onClick={() => void download("json")}>
        Export snapshot
      </button>
    </div>
  );

  if (page === "comparison") return <ComparisonView snapshot={snapshot} source={source} />;

  if (page === "suggestions")
    return (
      <section className="assessment-view">
        <div className="view-toolbar">
          <div>
            <h2>Review queue</h2>
            <p>
              Each suggestion includes its rule version, evidence, confidence, rationale, and
              verification steps.
            </p>
          </div>
          {downloads}
        </div>
        {notice && (
          <DismissibleNotice
            message={notice}
            dismissLabel="Dismiss suggestion notification"
            onDismiss={() => setNotice("")}
          />
        )}
        <div className="suggestion-filter-toolbar">
          <div className="suggestion-filters" role="group" aria-label="Filter suggestions by type">
            <button
              type="button"
              className={`suggestion-filter ${suggestionCategory === "all" ? "active" : ""}`}
              aria-pressed={suggestionCategory === "all"}
              onClick={() => setSuggestionCategory("all")}
            >
              All types
            </button>
            {categories.map((category) => (
              <button
                type="button"
                className={`suggestion-filter ${suggestionCategory === category ? "active" : ""}`}
                aria-pressed={suggestionCategory === category}
                key={category}
                onClick={() => setSuggestionCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
          <span className="filter-result-count" role="status" aria-live="polite">
            Showing {suggestions.length} of {snapshot.suggestions.length} suggestions
          </span>
        </div>
        {suggestions.length ? (
          suggestions.map((item) => (
            <article className="panel-card assessment-card" key={item.id}>
              <div className="assessment-card-head">
                <span className="category-mark blue">{item.category}</span>
                <span className="priority-pill">{item.priority}</span>
                <span className="confidence-label">{item.confidence} confidence</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.rationale}</p>
              <p>
                <strong>Suggested action:</strong> {item.action}
              </p>
              <div className="suggestion-evidence">
                <strong>Evidence</strong>
                {item.evidenceIds.map((id) => (
                  <span key={id}>
                    {evidence.get(id)?.path ?? evidence.get(id)?.description ?? id}
                  </span>
                ))}
              </div>
              <details>
                <summary>Verification steps</summary>
                <ol>
                  {item.verification.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </details>
              <div className="decision-actions">
                <button
                  className="soft-button"
                  disabled={workingId === item.fingerprint}
                  onClick={() => void decide(item, "accepted")}
                >
                  Mark accepted
                </button>
                <input
                  aria-label={`Dismissal reason for ${item.title}`}
                  value={workingId === item.fingerprint ? reason : reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Reason to dismiss"
                />
                <button
                  className="soft-button"
                  disabled={workingId === item.fingerprint}
                  onClick={() => void decide(item, "dismissed")}
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))
        ) : snapshot.suggestions.length === 0 ? (
          <div className="empty-state compact-empty">
            <Sparkles size={22} />
            <strong>No evidence-backed suggestions</strong>
            <span>Unknown or unsupported inputs do not become asserted defects.</span>
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <Sparkles size={22} />
            <strong>No suggestions match this type</strong>
            <span>Choose another category or show all suggestion types.</span>
            <button className="soft-button" onClick={() => setSuggestionCategory("all")}>
              Show all types
            </button>
          </div>
        )}
      </section>
    );

  if (page === "environments") {
    const items = snapshot.components.filter(
      (item) => item.kind === "pipeline" || item.kind === "test_suite",
    );
    return (
      <section className="assessment-view">
        <div className="view-toolbar">
          <div>
            <h2>Environments and delivery</h2>
            <p>File declarations are distinct from provider runs and deployed state.</p>
          </div>
          {downloads}
        </div>
        <div className="assessment-grid">
          {snapshot.environments.map((environment) => (
            <article className="panel-card assessment-card" key={environment.id}>
              <span className="eyebrow">ENVIRONMENT</span>
              <h3>{environment.name}</h3>
              <p>
                Environment is declared. Live deployment evidence is not queried by the local scan.
              </p>
            </article>
          ))}
          {items.map((item) => (
            <article className="panel-card assessment-card" key={item.id}>
              <span className="eyebrow">{item.kind.replaceAll("_", " ")}</span>
              <h3>{item.name}</h3>
              <p>{item.locator}</p>
              <ObservationList component={item} />
            </article>
          ))}
          {!items.length && !snapshot.environments.length && (
            <div className="empty-state compact-empty">
              <GitBranch size={22} />
              <strong>No environment or workflow declarations found</strong>
              <span>Coverage and unsupported inputs remain in the snapshot inventory.</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (page === "data") {
    const items = snapshot.components.filter(
      (item) => item.kind === "database" || item.kind === "migration",
    );
    return (
      <section className="assessment-view">
        <div className="view-toolbar">
          <div>
            <h2>Database and migration inventory</h2>
            <p>
              Migration files show repository declarations; application state stays unknown without
              live database evidence.
            </p>
          </div>
          {downloads}
        </div>
        <div className="assessment-grid">
          {items.map((item) => (
            <article className="panel-card assessment-card" key={item.id}>
              <span className="eyebrow">{item.kind}</span>
              <h3>{item.name}</h3>
              <p>{item.locator}</p>
              <ObservationList component={item} />
              {item.versions.map((version, index) => (
                <div className="version-row" key={`${version.facet}-${index}`}>
                  <span className={`version-facet ${version.facet}`}>{version.facet}</span>
                  <strong>{version.value}</strong>
                </div>
              ))}
            </article>
          ))}
          {!items.length && (
            <div className="empty-state compact-empty">
              <Database size={22} />
              <strong>No database or migration objects found</strong>
              <span>Unknown database state is not treated as a positive health result.</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  const documentation = new Map(snapshot.documentation.map((item) => [item.componentId, item]));
  const documentationComponents = filterDocumentationComponents(
    snapshot.components,
    snapshot.documentation,
    documentationQuery,
  );
  return (
    <section className="assessment-view">
      <div className="view-toolbar">
        <div>
          <h2>Service documentation appendix</h2>
          <p>{snapshot.components.length} components · gaps remain visible until reviewed.</p>
        </div>
        {downloads}
      </div>
      <div className="documentation-controls">
        <label className="documentation-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search documentation</span>
          <input
            type="search"
            value={documentationQuery}
            onChange={(event) => setDocumentationQuery(event.target.value)}
            placeholder="Search services, versions, status, links…"
          />
          {documentationQuery && (
            <button
              type="button"
              className="clear-documentation-search"
              onClick={() => setDocumentationQuery("")}
              aria-label="Clear documentation search"
            >
              Clear
            </button>
          )}
        </label>
        <span className="filter-result-count" role="status" aria-live="polite">
          Showing {documentationComponents.length} of {snapshot.components.length} documents
        </span>
      </div>
      <div className="table-wrap">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>SERVICE / COMPONENT</th>
              <th>VERSION</th>
              <th>STATUS</th>
              <th>OFFICIAL DOCUMENTATION</th>
              <th>INTERNAL GUIDE / GAP</th>
            </tr>
          </thead>
          <tbody>
            {documentationComponents.map((component) => {
              const doc = documentation.get(component.id);
              return (
                <tr key={component.id}>
                  <td>
                    <strong>{component.name}</strong>
                    <small>
                      {component.kind} · {component.locator}
                    </small>
                  </td>
                  <td>
                    {component.versions
                      .map((version) => `${version.facet}: ${version.value}`)
                      .join("; ") || "unknown"}
                  </td>
                  <td>
                    <DocumentationPill state={doc?.status ?? "undocumented"} />
                  </td>
                  <td>
                    {doc?.officialReferences.length
                      ? doc.officialReferences.map((reference) => (
                          <div key={reference.url}>
                            <a href={reference.url} target="_blank" rel="noreferrer">
                              {reference.title}
                            </a>
                            <small>
                              {reference.verifiedAt
                                ? `Checked ${reference.verifiedAt}`
                                : "Verification time unknown"}
                            </small>
                          </div>
                        ))
                      : "Not located"}
                  </td>
                  <td>
                    {doc?.internalPaths.map((path) => (
                      <div key={path}>{path}</div>
                    ))}
                    {doc?.gap ?? "No internal documentation record."}
                  </td>
                </tr>
              );
            })}
            {documentationComponents.length === 0 && (
              <tr>
                <td className="documentation-empty-row" colSpan={5}>
                  <strong>No documentation matches your search.</strong>
                  <button className="soft-button" onClick={() => setDocumentationQuery("")}>
                    Clear search
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ObservationList({ component }: { component: Component }) {
  return (
    <div className="observation-list">
      {component.observations.length ? (
        component.observations.map((item, index) => (
          <div className="observation-row" key={`${item.dimension}-${index}`}>
            <span>{item.dimension}</span>
            <span className="observation-state unknown">
              <i />
              {item.state.replaceAll("_", " ")}
            </span>
          </div>
        ))
      ) : (
        <div className="detail-muted">No status observation was collected.</div>
      )}
    </div>
  );
}

function ComparisonView({ snapshot, source }: { snapshot: Snapshot; source: SnapshotSource }) {
  const [history, setHistory] = useState<
    Array<{
      id: string;
      capturedAt: string;
      assessmentStatus: string;
      componentCount: number;
      relationshipCount: number;
    }>
  >([]);
  const [baseId, setBaseId] = useState("");
  const [diff, setDiff] = useState<{
    added: string[];
    removed: string[];
    changed: Array<{ id: string; fields: string[] }>;
  } | null>(null);
  const [error, setError] = useState("");
  const [repositoryChanges, setRepositoryChanges] = useState<RepositoryChanges | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  useEffect(() => {
    let active = true;
    source
      .listHistory?.(snapshot.projectId)
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Snapshot history is unavailable.");
      });
    source
      .getRepositoryChanges?.(snapshot.id)
      .then((changes) => {
        if (!active) return;
        setRepositoryChanges(changes);
        setSelectedPaths([]);
      })
      .catch((cause: unknown) => {
        if (active)
          setRepositoryChanges({
            available: false,
            reason: cause instanceof Error ? cause.message : "Repository changes are unavailable.",
            sourceRevision: snapshot.sourceRevision,
            currentRevision: null,
            changeToken: null,
            files: [],
          });
      });
    return () => {
      active = false;
    };
  }, [snapshot.id, snapshot.projectId, snapshot.sourceRevision, source]);
  const choices = history.filter((item) => item.id !== snapshot.id);
  const compare = async () => {
    try {
      if (!source.compareSnapshots || !baseId) return;
      setError("");
      setDiff(await source.compareSnapshots(snapshot.id, baseId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Snapshot comparison failed.");
    }
  };
  const restoreFiles = async () => {
    if (
      !source.restoreProjectFiles ||
      !repositoryChanges?.currentRevision ||
      !repositoryChanges.changeToken ||
      selectedPaths.length === 0
    ) {
      return;
    }
    const confirmed = window.confirm(
      `Restore ${selectedPaths.length} selected tracked file(s) to the Git commit recorded by this scan? Their current contents will be overwritten. SeedBoard does not keep a backup of the current contents. Untracked files are not included.`,
    );
    if (!confirmed) return;
    setRestoring(true);
    setError("");
    setRestoreMessage("");
    try {
      const result = await source.restoreProjectFiles(
        snapshot.projectId,
        snapshot.id,
        repositoryChanges,
        selectedPaths,
      );
      setRepositoryChanges(result.changes);
      setSelectedPaths([]);
      setRestoreMessage(
        `Restored ${result.restoredPaths.length} file(s) to the revision recorded by this scan.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The selected files could not be restored.",
      );
      if (cause instanceof Error && cause.message.includes("changed after the preview")) {
        const refreshed = await source.getRepositoryChanges?.(snapshot.id).catch(() => null);
        if (refreshed) setRepositoryChanges(refreshed);
      }
    } finally {
      setRestoring(false);
    }
  };
  return (
    <section className="assessment-view">
      <div className="panel-card repository-change-panel">
        <div className="repository-change-heading">
          <div>
            <h2>Project file changes since this scan</h2>
            <p>Read-only Git comparison against the commit captured when the scan started.</p>
          </div>
          {repositoryChanges?.available && repositoryChanges.files.length > 0 && (
            <button
              className="soft-button danger-button"
              disabled={
                restoring ||
                selectedPaths.length === 0 ||
                !source.restoreProjectFiles ||
                !repositoryChanges.changeToken
              }
              onClick={() => void restoreFiles()}
            >
              {restoring ? "Restoring…" : `Restore selected (${selectedPaths.length})`}
            </button>
          )}
        </div>
        {!snapshot.demo && (
          <p className="restore-safety-note">
            Restoring overwrites selected tracked files with their contents from the scan commit.
            Review the paths carefully and keep a separate backup of work you may need. Staged paths
            are protected, and untracked files are not included.
          </p>
        )}
        {snapshot.demo ? (
          <p className="muted-copy">
            Repository file history is available for registered local projects.
          </p>
        ) : repositoryChanges === null ? (
          <span className="muted-copy">Checking the local Git worktree…</span>
        ) : !repositoryChanges.available ? (
          <p className="muted-copy">{repositoryChanges.reason}</p>
        ) : repositoryChanges.files.length === 0 ? (
          <p className="muted-copy">No tracked file changes since this scan.</p>
        ) : (
          <div className="repository-change-list">
            {repositoryChanges.files.map(({ path, status, restorable }) => (
              <label className="repository-change-row" key={path}>
                <input
                  type="checkbox"
                  checked={selectedPaths.includes(path)}
                  disabled={restoring || !source.restoreProjectFiles || !restorable}
                  onChange={(event) =>
                    setSelectedPaths((current) =>
                      event.target.checked
                        ? [...current, path]
                        : current.filter((item) => item !== path),
                    )
                  }
                />
                <span className="repository-change-status">
                  {restorable ? repositoryStatus(status) : "Staged · protected"}
                </span>
                <code>{path}</code>
              </label>
            ))}
          </div>
        )}
        {restoreMessage && (
          <p className="inline-success" role="status">
            {restoreMessage}
          </p>
        )}
      </div>
      <div className="view-toolbar">
        <div>
          <h2>Compare with an earlier snapshot</h2>
          <p>
            Stable component, relationship, and suggestion identifiers determine the change list.
          </p>
        </div>
        <div className="export-actions">
          <label className="layer-select">
            <span className="sr-only">Earlier snapshot</span>
            <select value={baseId} onChange={(event) => setBaseId(event.target.value)}>
              <option value="">Choose a snapshot</option>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.capturedAt).toLocaleString()} · {item.componentCount} objects
                </option>
              ))}
            </select>
          </label>
          <button
            className="soft-button"
            disabled={!baseId || !source.compareSnapshots}
            onClick={() => void compare()}
          >
            Compare
          </button>
        </div>
      </div>
      {snapshot.demo && (
        <div className="empty-state compact-empty">
          <GitBranch size={22} />
          <strong>Demo snapshots are not persisted</strong>
          <span>Run two local scans to compare project history.</span>
        </div>
      )}
      {error && (
        <DismissibleNotice
          message={error}
          dismissLabel="Dismiss comparison notification"
          onDismiss={() => setError("")}
        />
      )}
      {!snapshot.demo && choices.length === 0 && (
        <div className="empty-state compact-empty">
          <GitBranch size={22} />
          <strong>No earlier snapshots yet</strong>
          <span>Run another scan after your next repository change to create a comparison.</span>
        </div>
      )}
      {diff && (
        <>
          <div className="assessment-grid">
            <article className="panel-card assessment-card">
              <span className="eyebrow">ADDED</span>
              <h3>{diff.added.length}</h3>
            </article>
            <article className="panel-card assessment-card">
              <span className="eyebrow">REMOVED</span>
              <h3>{diff.removed.length}</h3>
            </article>
            <article className="panel-card assessment-card">
              <span className="eyebrow">CHANGED</span>
              <h3>{diff.changed.length}</h3>
            </article>
          </div>
          <div className="panel-card assessment-card">
            <h3>Changed object details</h3>
            {[
              ...diff.added.map((id) => ({ id, state: "Added", fields: [] })),
              ...diff.removed.map((id) => ({ id, state: "Removed", fields: [] })),
              ...diff.changed.map((item) => ({ ...item, state: "Changed" })),
            ].map((item) => (
              <div className="observation-row" key={`${item.state}-${item.id}`}>
                <strong>
                  {item.state}: {item.id}
                </strong>
                <span>{item.fields.join(", ")}</span>
              </div>
            ))}
            {diff.added.length + diff.removed.length + diff.changed.length === 0 && (
              <p>No changes between these snapshots.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function repositoryStatus(status: string): string {
  if (status.startsWith("A")) return "Added";
  if (status.startsWith("D")) return "Deleted";
  if (status.startsWith("T")) return "Type changed";
  return "Modified";
}

function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone,
  trend,
  destination,
  onClick,
}: {
  label: string;
  value: number;
  helper: string;
  icon: typeof Boxes;
  tone: string;
  trend: string;
  destination: string;
  onClick: () => void;
}) {
  return (
    <button
      className="metric-card metric-card-link"
      onClick={onClick}
      aria-label={`${label}: ${value}. Open ${destination}.`}
      title={`Open ${destination}`}
    >
      <div className={`metric-icon ${tone}`}>
        <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="metric-trend">
        <span className={`trend-marker ${tone}`}>
          <ArrowUpRight size={12} />
        </span>
        {trend}
      </div>
      <div className="metric-main">
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
      <div className="metric-helper">{helper}</div>
    </button>
  );
}

function InventoryView({
  components,
  snapshot,
  source,
  selectedId,
  onSelect,
  layer,
  onLayerChange,
  total,
}: {
  components: Component[];
  snapshot: Snapshot;
  source: SnapshotSource;
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
  const sorted = useMemo(
    () => [...components].sort((a, b) => a.name.localeCompare(b.name)),
    [components],
  );
  return (
    <section className="inventory-section panel-card">
      <PackageAdvisories snapshot={snapshot} source={source} />
      <div className="inventory-toolbar">
        <div>
          <div className="section-title-row">
            <h2>All components</h2>
            <span className="section-count">
              {components.length} / {total}
            </span>
          </div>
          <p>Exact object totals are independent of map filters and grouping.</p>
        </div>
        <label className="layer-select">
          <ListFilter size={14} />
          <span className="sr-only">Filter inventory by layer</span>
          <select
            value={layer}
            onChange={(event) => onLayerChange(event.target.value as LayerFilter)}
          >
            <option value="all">All layers</option>
            {["frontend", "backend", "testing", "data", "delivery", "shared", "external"].map(
              (value) => (
                <option key={value} value={value}>
                  {value[0]!.toUpperCase() + value.slice(1)}
                </option>
              ),
            )}
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      {sorted.length === 0 ? (
        <div className="empty-state compact-empty">
          <Search size={23} />
          <strong>Nothing found</strong>
          <span>Clear your search or choose another layer.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>COMPONENT</th>
                <th>TYPE</th>
                <th>LAYER</th>
                <th>VERSION</th>
                <th>STATUS</th>
                <th>DOCUMENTATION</th>
                <th>
                  <span className="sr-only">Open component</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((component) => {
                const version =
                  component.versions.find((item) => item.facet === "resolved") ??
                  component.versions.find((item) => item.facet === "declared");
                const state =
                  component.observations.find((item) => item.dimension === "health")?.state ??
                  "not observed";
                const doc = documentation.get(component.id) ?? "undocumented";
                return (
                  <tr
                    className={selectedId === component.id ? "selected-row" : ""}
                    key={component.id}
                    onClick={() => onSelect(component.id)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(component.id);
                      }
                    }}
                  >
                    <td>
                      <div className="component-cell">
                        <span className={`table-kind-icon ${component.layer}`}>
                          <ComponentGlyph kind={component.kind} />
                        </span>
                        <span>
                          <strong>{component.name}</strong>
                          <small>{component.locator}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="plain-type">{component.kind.replaceAll("_", " ")}</span>
                    </td>
                    <td>
                      <span className={`layer-label ${component.layer}`}>{component.layer}</span>
                    </td>
                    <td>
                      <span className="version-label">{version?.value ?? "—"}</span>
                    </td>
                    <td>
                      <StatusPill state={state} />
                    </td>
                    <td>
                      <DocumentationPill state={doc} />
                    </td>
                    <td>
                      <button
                        className="row-open"
                        onClick={() => onSelect(component.id)}
                        aria-label={`Inspect ${component.name}`}
                      >
                        <ArrowRight size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="inventory-bottom-note">
        <span>
          <Database size={13} /> Versions stay separated by evidence source.
        </span>
        <span>
          Showing {sorted.length} of {total} components
        </span>
      </div>
    </section>
  );
}

function StatusPill({ state }: { state: string }) {
  const mapped =
    state === "healthy" || state === "passed"
      ? "positive"
      : state === "unhealthy" || state === "failed"
        ? "negative"
        : "unknown";
  return (
    <span className={`status-pill ${mapped}`}>
      <i />
      {state.replaceAll("_", " ")}
    </span>
  );
}

function DocumentationPill({ state }: { state: string }) {
  return (
    <span className={`docs-pill ${state}`}>
      <i />
      {state}
    </span>
  );
}

function ComponentGlyph({ kind }: { kind: string }) {
  if (kind === "database" || kind === "migration") return <Database size={15} />;
  if (kind === "pipeline") return <Workflow size={15} />;
  if (kind === "test_suite") return <Check size={15} />;
  if (kind === "external_service" || kind === "api_endpoint") return <Cable size={15} />;
  if (kind === "package") return <Boxes size={15} />;
  return <FileCode2 size={15} />;
}

function PipelineNode({
  icon: Icon,
  name,
  detail,
  status,
}: {
  icon: typeof Database;
  name: string;
  detail: string;
  status: string;
}) {
  return (
    <div className={`pipeline-node ${status}`}>
      <span className="pipeline-node-icon">
        <Icon size={15} />
      </span>
      <strong>{name}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SuggestionPreview({
  category,
  title,
  priority,
  tone,
}: {
  category: string;
  title: string;
  priority: string;
  tone: string;
}) {
  return (
    <div className="suggestion-preview-row">
      <span className={`category-mark ${tone}`}>{category.slice(0, 1)}</span>
      <span className="suggestion-copy">
        <strong>{title}</strong>
        <small>
          {category} <i /> synthetic evidence
        </small>
      </span>
      <span className={`priority-pill ${priority.toLowerCase()}`}>{priority}</span>
    </div>
  );
}
