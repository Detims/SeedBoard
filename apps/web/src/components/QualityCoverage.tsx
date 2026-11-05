import { ArrowRight, Check, CircleHelp, GitBranch, ShieldAlert, Workflow } from "lucide-react";
import type { Snapshot } from "@modernizer/contracts";
import { getQualityCoverageSummary, HIGH_DEPENDENCY_THRESHOLD } from "../domain.js";

export function QualityCoverage({
  snapshot,
  onInspectComponent,
}: {
  snapshot: Snapshot;
  onInspectComponent: (componentId: string) => void;
}) {
  const summary = getQualityCoverageSummary(snapshot);

  return (
    <section className="assessment-view quality-coverage-view">
      <div className="view-toolbar">
        <div>
          <h2>Test and deployment coverage</h2>
          <p>
            Repository declarations show what is mapped for testing and delivery. SeedBoard does not
            run tests or contact deployment providers.
          </p>
        </div>
      </div>

      <div className="quality-summary-grid" aria-label="Coverage summary">
        <SummaryCard
          icon={Check}
          label="Declared test suites"
          value={summary.testSuites.length}
          detail="Found in repository metadata"
        />
        <SummaryCard
          icon={ShieldAlert}
          label="Test mappings"
          value={`${summary.testMappedCount} / ${summary.testableComponentCount}`}
          detail="Components linked to a declared suite"
        />
        <SummaryCard
          icon={CircleHelp}
          label="Measured test coverage"
          value={
            summary.measuredTestCoveragePercent === null
              ? "Unknown"
              : `${summary.measuredTestCoveragePercent}%`
          }
          detail="No coverage report is collected"
        />
        <SummaryCard
          icon={Workflow}
          label="Pipeline declarations"
          value={summary.pipelines.length}
          detail="Workflow files found"
        />
        <SummaryCard
          icon={GitBranch}
          label="Deploy mappings"
          value={`${summary.deployMappedCount} / ${summary.deployableComponentCount}`}
          detail="Components linked to a workflow"
        />
        <SummaryCard
          icon={CircleHelp}
          label="Live deployment status"
          value="Unknown"
          detail="No provider state was queried"
        />
      </div>

      <div className="quality-evidence-grid">
        <section className="panel-card quality-evidence-card" aria-labelledby="quality-tests-title">
          <div className="panel-header">
            <div>
              <div className="section-title-row">
                <h3 id="quality-tests-title">Test evidence</h3>
                <span className="mini-status unknown-status">DECLARATIONS</span>
              </div>
              <p>Test suite files and explicit test relationships in this snapshot.</p>
            </div>
            <Check size={18} className="panel-header-icon" aria-hidden="true" />
          </div>
          {summary.testSuites.length ? (
            <ul className="quality-evidence-list">
              {summary.testSuites.map((suite) => (
                <li key={suite.id}>
                  <strong>{suite.name}</strong>
                  <span>{suite.locator}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quality-empty-note">No test suite declaration was found.</p>
          )}
          <div className="quality-limit-note">
            <CircleHelp size={14} aria-hidden="true" />
            <span>
              A mapping is not a measured test result or line-coverage percentage. Missing mappings
              mean unknown evidence, not proof that a component is untested.
            </span>
          </div>
        </section>

        <section
          className="panel-card quality-evidence-card"
          aria-labelledby="quality-deploy-title"
        >
          <div className="panel-header">
            <div>
              <div className="section-title-row">
                <h3 id="quality-deploy-title">Delivery evidence</h3>
                <span className="mini-status unknown-status">DECLARATIONS</span>
              </div>
              <p>Workflow files and components explicitly linked as deployment targets.</p>
            </div>
            <GitBranch size={18} className="panel-header-icon" aria-hidden="true" />
          </div>
          {summary.pipelines.length ? (
            <ul className="quality-evidence-list">
              {summary.pipelines.map((pipeline) => (
                <li key={pipeline.id}>
                  <strong>{pipeline.name}</strong>
                  <span>{pipeline.locator}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quality-empty-note">No workflow declaration was found.</p>
          )}
          <div className="quality-limit-note">
            <CircleHelp size={14} aria-hidden="true" />
            <span>
              Workflow presence does not confirm a successful run or healthy deployment. No live CI
              provider, environment, or deploy status was queried.
            </span>
          </div>
        </section>
      </div>

      <section className="panel-card quality-risk-card" aria-labelledby="quality-review-title">
        <div className="panel-header">
          <div>
            <div className="section-title-row">
              <h3 id="quality-review-title">Components to review</h3>
              <span className="section-count">{summary.risks.length} signals</span>
            </div>
            <p>
              Review signals mark components with {HIGH_DEPENDENCY_THRESHOLD}+ direct dependencies
              or no explicit test mapping.
            </p>
          </div>
          <ShieldAlert size={18} className="panel-header-icon" aria-hidden="true" />
        </div>
        {summary.risks.length ? (
          <div className="quality-risk-list">
            {summary.risks.map(({ component, dependencyCount, hasTestMapping }) => (
              <article className="quality-risk-row" key={component.id}>
                <div className="quality-risk-copy">
                  <strong>{component.name}</strong>
                  <span>{component.locator}</span>
                </div>
                <div className="quality-risk-signals">
                  {dependencyCount >= HIGH_DEPENDENCY_THRESHOLD && (
                    <span className="quality-signal dependency-signal">
                      {dependencyCount} direct dependencies
                    </span>
                  )}
                  {!hasTestMapping && (
                    <span className="quality-signal unknown-signal">No explicit test mapping</span>
                  )}
                </div>
                <button
                  type="button"
                  className="text-link quality-inspect-button"
                  onClick={() => onInspectComponent(component.id)}
                >
                  Inspect <ArrowRight size={14} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="quality-empty-note">
            No review signals met the current rules. Test execution and measured coverage remain
            unknown without those data sources.
          </p>
        )}
      </section>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Check;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article className="panel-card quality-summary-card">
      <span className="quality-summary-icon">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="quality-summary-label">{label}</span>
      <strong>{value}</strong>
      <span className="quality-summary-detail">{detail}</span>
    </article>
  );
}
