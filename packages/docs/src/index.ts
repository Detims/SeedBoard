import type { Documentation, Snapshot } from "@modernizer/contracts";

const safePath = (value: string): boolean =>
  value.length > 0 && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) &&
  !value.includes("\\") && !value.includes("\0") &&
  value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");

function cleanUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function plain(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function markdown(value: string): string {
  return plain(value).replace(/([\\`*_{}\[\]<>()#+\-.!|])/g, "\\$1");
}

/** Ensure one documentation record per component; gaps and duplicates remain visible. */
export function resolveDocumentation(snapshot: Snapshot): Documentation[] {
  const byComponent = new Map<string, Documentation[]>();
  for (const item of snapshot.documentation) {
    const records = byComponent.get(item.componentId) ?? [];
    records.push(item);
    byComponent.set(item.componentId, records);
  }
  return snapshot.components.map((component) => {
    const records = byComponent.get(component.id) ?? [];
    const chosen = records[0];
    if (!chosen) return {
      componentId: component.id, status: "undocumented", officialReferences: [],
      internalPaths: [], reviewedAt: null, gap: "No documentation record was collected; create and review an internal service guide.",
    };
    const references = chosen.officialReferences.flatMap((reference) => {
      const url = cleanUrl(reference.url);
      return url ? [{ ...reference, title: plain(reference.title) || "Official documentation", url }] : [];
    });
    const paths = [...new Set(chosen.internalPaths.filter(safePath))];
    const duplicateGap = records.length > 1 ? ` ${records.length - 1} duplicate documentation record(s) were collapsed; review the source.` : "";
    const invalidGap = chosen.officialReferences.length !== references.length || chosen.internalPaths.length !== paths.length
      ? " Unsafe documentation URL or path was removed." : "";
    const gap = [chosen.gap, duplicateGap.trim(), invalidGap.trim()].filter(Boolean).join(" ") || null;
    const status = (gap && chosen.status === "complete") ? "partial" : chosen.status;
    return { ...chosen, status, officialReferences: references, internalPaths: paths, gap };
  });
}

export function createGuideStub(snapshot: Snapshot, componentId: string): string | null {
  const component = snapshot.components.find((item) => item.id === componentId);
  if (!component) return null;
  const doc = resolveDocumentation(snapshot).find((item) => item.componentId === componentId)!;
  const name = markdown(component.name);
  const purpose = markdown(component.kind.replaceAll("_", " "));
  const versions = component.versions.map((version) => `- ${markdown(version.facet)}: ${markdown(version.value)} (observed ${markdown(version.observedAt)})`).join("\n") || "- Unknown; no version evidence was collected.";
  const official = doc.officialReferences.map((reference) => `- [${markdown(reference.title)}](${reference.url}) — verification: ${reference.verifiedAt ? markdown(reference.verifiedAt) : "not recorded"}`).join("\n") || "- No official documentation reference was located.";
  const internal = doc.internalPaths.map((path) => `- \`${path}\``).join("\n") || "- No reviewed internal guide exists.";
  return `# ${name}\n\nStatus: ${doc.status}. This generated guide is a draft; verify unknowns with the component owner.\n\n## Known purpose\n\n${purpose} (inferred from the declared component type).\n\n## Version evidence\n\n${versions}\n\n## Official documentation\n\n${official}\n\n## Internal references\n\n${internal}\n\n## Configuration and operations\n\nUnknown; no verified setup or operational evidence was supplied. Do not add credential values.\n\n## Open questions\n\n- Confirm purpose, owner, configuration names, authentication boundaries, failure handling, and upgrade procedure.\n- Review official documentation for the observed version and record verification time.\n`;
}

export function exportSnapshotJson(snapshot: Snapshot): string {
  const documentation = resolveDocumentation(snapshot);
  const evidence = snapshot.evidence.map((item) => ({
    ...item,
    url: item.url ? cleanUrl(item.url) : null,
  }));
  return `${JSON.stringify({ ...snapshot, evidence, documentation }, null, 2)}\n`;
}

export function exportBacklogMarkdown(snapshot: Snapshot): string {
  const rows = [...snapshot.suggestions].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  const body = rows.length ? rows.map((item) => `## ${markdown(item.category)}: ${markdown(item.title)}\n\n- Priority: ${markdown(item.priority)}\n- Confidence: ${markdown(item.confidence)}\n- Rule: ${markdown(item.ruleId)} v${item.ruleVersion}\n- Rationale: ${markdown(item.rationale)}\n- Action: ${markdown(item.action)}\n- Verify: ${item.verification.map(markdown).join("; ")}\n`).join("\n") : "No suggestions were recorded.\n";
  return `# Modernization backlog — ${markdown(snapshot.projectId)}\n\n${snapshot.demo ? "Demo data. " : ""}Suggestions are review-only and have not been applied.\n\n${body}`;
}

export function exportDocumentationAppendix(snapshot: Snapshot): string {
  const docs = new Map(resolveDocumentation(snapshot).map((item) => [item.componentId, item]));
  const components = [...snapshot.components].sort((a, b) => a.layer.localeCompare(b.layer) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const lines = components.map((component) => {
    const doc = docs.get(component.id)!;
    const references = doc.officialReferences.map((reference) => `[${markdown(reference.title)}](${reference.url})${reference.verifiedAt ? ` (checked ${markdown(reference.verifiedAt)})` : " (verification time unknown)"}`).join(", ") || "not located";
    const paths = doc.internalPaths.map((path) => `\`${path}\``).join(", ") || "none";
    const versions = component.versions.map((version) => `${markdown(version.facet)} ${markdown(version.value)}`).join(", ") || "unknown";
    return `| ${markdown(component.name)} | ${markdown(component.kind)} | ${markdown(versions)} | ${doc.status} | ${references} | ${paths} | ${markdown(doc.gap ?? "")} |`;
  });
  return `# Documentation appendix\n\n${snapshot.demo ? "**Demo data** — synthetic component records.\n\n" : ""}Objects: ${components.length}. Every component has one resolved record; missing information stays explicit.\n\n| Component | Type | Versions | Status | Official references | Internal paths | Gaps |\n| --- | --- | --- | --- | --- | --- | --- |\n${lines.join("\n")}\n`;
}
