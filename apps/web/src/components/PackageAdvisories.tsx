import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, CircleHelp, ExternalLink } from "lucide-react";
import type { Snapshot } from "@modernizer/contracts";
import type { PackageAdvisoryReport, SnapshotSource } from "../snapshotSource.js";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function PackageAdvisories({
  snapshot,
  source,
}: {
  snapshot: Snapshot;
  source: SnapshotSource;
}) {
  const [consented, setConsented] = useState(false);
  const [report, setReport] = useState<PackageAdvisoryReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const packageCount = snapshot.components.filter(
    (component) => component.kind === "package",
  ).length;

  const check = async () => {
    if (!source.checkPackageAdvisories || !consented) return;
    setBusy(true);
    setError("");
    try {
      setReport(await source.checkPackageAdvisories(snapshot.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check package status.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="package-advisory-panel panel-card" aria-labelledby="package-advisory-title">
      <div className="advisory-heading">
        <div>
          <div className="section-title-row">
            <Activity size={18} aria-hidden="true" />
            <h2 id="package-advisory-title">Package age and support</h2>
          </div>
          <p>
            Check resolved npm package versions against the public registry and Node.js lifecycle
            data. Other runtime lifecycles remain unknown. This is not a vulnerability scan.
          </p>
        </div>
        {source.checkPackageAdvisories && (
          <button
            className="soft-button"
            onClick={() => void check()}
            disabled={!consented || busy}
          >
            {busy ? "Checking…" : report ? "Check again" : "Check package status"}
          </button>
        )}
      </div>

      {source.checkPackageAdvisories ? (
        <label className="advisory-consent">
          <input
            type="checkbox"
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
          />
          <span>
            I agree to send package names to the public npm registry; installed versions are
            compared locally. For recognized runtimes, SeedBoard also checks endoflife.date. No
            project files are sent.
          </span>
        </label>
      ) : (
        <p className="advisory-demo-note">
          Package lookups are available for a registered local project; synthetic demo data is not
          sent to external sources.
        </p>
      )}

      {error && (
        <p className="advisory-error" role="alert">
          {error}
        </p>
      )}

      {!report ? (
        <p className="advisory-idle">
          {packageCount ? `${packageCount} package records found. ` : "No package records found. "}
          {source.checkPackageAdvisories ? "Select the consent box to enable a lookup." : ""}
        </p>
      ) : (
        <>
          <div className="advisory-report-meta" role="status">
            <strong>Checked {timeFormat.format(new Date(report.checkedAt))}</strong>
            <span>
              {report.checkedPackages} of {report.totalPackages} unique packages checked
              {report.truncated ? "; additional packages were skipped to keep lookups bounded" : ""}
              .
            </span>
          </div>
          {report.sources.map((item) => (
            <div className="advisory-source" key={item.name}>
              <span>
                Data source:{" "}
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.name}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </span>
              <span>
                Source data retrieved {timeFormat.format(new Date(item.retrievedAt))}
                {item.cached ? " (cached)" : ""}
              </span>
            </div>
          ))}
          {report.packages.length > 0 && (
            <div className="advisory-results" aria-label="Package version results">
              {report.packages.map((item) => (
                <div className="advisory-result" key={item.componentId}>
                  <span className={`advisory-status ${item.status}`}>
                    {item.status === "outdated" ? (
                      <AlertTriangle size={14} />
                    ) : item.status === "current" ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <CircleHelp size={14} />
                    )}
                    {item.status === "outdated"
                      ? "Update available"
                      : item.status === "current"
                        ? "Current"
                        : "Unknown"}
                  </span>
                  <span className="advisory-package-name">{item.name}</span>
                  <span>
                    {item.installedVersion}
                    {item.latestVersion ? ` → ${item.latestVersion}` : ""}
                  </span>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open npm source for ${item.name}`}
                  >
                    npm source <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              ))}
            </div>
          )}
          {report.lifecycles.map((item) => (
            <div className="advisory-result lifecycle-result" key={item.componentId}>
              <span className={`advisory-status ${item.status}`}>
                {item.status === "eol" || item.status === "unsupported" ? (
                  <AlertTriangle size={14} />
                ) : item.status === "supported" ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <CircleHelp size={14} />
                )}
                {item.status === "eol"
                  ? "End of life"
                  : item.status === "unsupported"
                    ? "Unsupported"
                    : item.status === "supported"
                      ? "Supported"
                      : "Lifecycle unknown"}
              </span>
              <span className="advisory-package-name">{item.name}</span>
              <span>
                {item.version}
                {item.cycle ? ` · cycle ${item.cycle}` : ""}
                {item.endOfLife ? ` · EOL ${item.endOfLife}` : ""}
              </span>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                endoflife.date <ExternalLink size={12} aria-hidden="true" />
              </a>
            </div>
          ))}
          {!report.packages.length && !report.lifecycles.length && (
            <p className="advisory-idle">
              No resolved package versions or supported lifecycle records were available.
            </p>
          )}
        </>
      )}
    </section>
  );
}
