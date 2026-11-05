import type { Snapshot } from "@modernizer/contracts";

const npmRegistryBase = "https://registry.npmjs.org";
const eolApiBase = "https://endoflife.date/api/v1/products";
const npmDocsBase = "https://www.npmjs.com/package";
const eolDocsBase = "https://endoflife.date";
const packageLimit = 40;
const cacheLifetimeMs = 15 * 60_000;
const cacheEntryLimit = 128;
const responseSizeLimit = 128_000;
const requestTimeoutMs = 4_000;
const cache = new Map<string, { value: unknown; retrievedAt: string; expiresAt: number }>();

export type AdvisoryFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type PackageAdvisoryReport = {
  checkedAt: string;
  totalPackages: number;
  checkedPackages: number;
  truncated: boolean;
  sources: Array<{ name: string; url: string; retrievedAt: string; cached: boolean }>;
  packages: Array<{
    componentId: string;
    name: string;
    installedVersion: string;
    latestVersion: string | null;
    status: "current" | "outdated" | "unknown";
    sourceUrl: string;
  }>;
  lifecycles: Array<{
    componentId: string;
    name: string;
    version: string;
    product: string;
    cycle: string | null;
    status: "supported" | "unsupported" | "eol" | "unknown";
    endOfLife: string | null;
    sourceUrl: string;
  }>;
};

type PackageRef = { componentId: string; name: string; version: string };
type SourceObservation = { retrievedAt: string; cached: boolean };
type ProviderValue = { value: unknown; observation: SourceObservation };

/**
 * Explicit, bounded public metadata lookups. This never reads target files; callers provide only
 * validated snapshot component names and versions after the user has opted in.
 */
export async function checkPackageAdvisories(
  snapshot: Snapshot,
  options: { fetcher?: AdvisoryFetch; now?: () => Date } = {},
): Promise<PackageAdvisoryReport> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const packages = snapshot.components.flatMap((component) => {
    if (component.kind !== "package") return [];
    const version = component.versions.find((item) => item.facet === "resolved")?.value;
    if (!version || !isNpmName(component.name)) return [];
    return [{ componentId: component.id, name: component.name, version }];
  });
  const uniquePackages = new Map<string, PackageRef>();
  for (const item of packages) uniquePackages.set(item.name, item);
  const limited = [...uniquePackages.values()].slice(0, packageLimit);
  const latestByName = new Map<string, ProviderValue | null>();
  await mapLimit(limited, 5, async (item) => {
    const encodedName = item.name.replace("/", "%2f");
    const url = `${npmRegistryBase}/${encodedName}/latest`;
    const result = await readCachedJson(url, fetcher, now);
    latestByName.set(item.name, result);
  });

  const npmSources = [...latestByName.values()].flatMap((result) =>
    result
      ? [
          {
            name: "npm public registry",
            url: "https://docs.npmjs.com/cli/v11/using-npm/registry/",
            retrievedAt: result.observation.retrievedAt,
            cached: result.observation.cached,
          },
        ]
      : [],
  );
  const sources = dedupeSources(npmSources);

  const runtimeRefs = snapshot.components.flatMap((component) => {
    if (component.kind !== "runtime") return [];
    const product = eolProductFor(component.name);
    const version = component.versions.find((item) => item.facet === "resolved")?.value;
    return product && version
      ? [{ componentId: component.id, name: component.name, version, product }]
      : [];
  });
  const eolByProduct = new Map<string, ProviderValue | null>();
  for (const product of new Set(runtimeRefs.map((item) => item.product))) {
    eolByProduct.set(product, await readCachedJson(`${eolApiBase}/${product}`, fetcher, now));
  }
  const eolSources = [...eolByProduct.values()].flatMap((result) =>
    result
      ? [
          {
            name: "endoflife.date",
            url: "https://endoflife.date/docs/api/v1/",
            retrievedAt: result.observation.retrievedAt,
            cached: result.observation.cached,
          },
        ]
      : [],
  );
  sources.push(...dedupeSources(eolSources));

  const packageRows = packages.map((item) => {
    const result = latestByName.get(item.name) ?? null;
    const latest =
      isRecord(result?.value) && typeof result.value.version === "string"
        ? result.value.version
        : null;
    const comparison = latest ? compareVersions(item.version, latest) : null;
    return {
      componentId: item.componentId,
      name: item.name,
      installedVersion: item.version,
      latestVersion: latest,
      status:
        comparison === null
          ? ("unknown" as const)
          : comparison < 0
            ? ("outdated" as const)
            : ("current" as const),
      sourceUrl: `${npmDocsBase}/${encodeURIComponent(item.name)}`,
    };
  });

  const lifecycleRows = runtimeRefs.map((item) => {
    const result = eolByProduct.get(item.product) ?? null;
    const releases =
      isRecord(result?.value) &&
      isRecord(result.value.result) &&
      Array.isArray(result.value.result.releases)
        ? result.value.result.releases
        : [];
    const cycle = releaseCycleFor(releases, item.version);
    const sourceUrl = `${eolDocsBase}/${item.product}`;
    const cycleName = cycle && typeof cycle.name === "string" ? cycle.name : null;
    const status =
      !cycle ||
      !cycleName ||
      typeof cycle.isEol !== "boolean" ||
      typeof cycle.isMaintained !== "boolean"
        ? ("unknown" as const)
        : cycle.isEol
          ? ("eol" as const)
          : cycle.isMaintained
            ? ("supported" as const)
            : ("unsupported" as const);
    return {
      componentId: item.componentId,
      name: item.name,
      version: item.version,
      product: item.product,
      cycle: cycleName,
      status,
      endOfLife: cycle && typeof cycle.eolFrom === "string" ? cycle.eolFrom : null,
      sourceUrl,
    };
  });

  return {
    checkedAt,
    totalPackages: uniquePackages.size,
    checkedPackages: limited.length,
    truncated: uniquePackages.size > packageLimit,
    sources,
    packages: packageRows,
    lifecycles: lifecycleRows,
  };
}

export function clearPackageAdvisoryCache(): void {
  cache.clear();
}

async function readCachedJson(
  url: string,
  fetcher: AdvisoryFetch,
  now: () => Date,
): Promise<ProviderValue | null> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > now().getTime()) {
    return {
      value: cached.value,
      observation: { retrievedAt: cached.retrievedAt, cached: true },
    };
  }
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > responseSizeLimit) return null;
    const text = await response.text();
    if (text.length > responseSizeLimit) return null;
    const value: unknown = JSON.parse(text);
    const retrievedAt = now().toISOString();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now().getTime()) cache.delete(key);
    }
    if (!cache.has(url) && cache.size >= cacheEntryLimit) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(url, { value, retrievedAt, expiresAt: now().getTime() + cacheLifetimeMs });
    return { value, observation: { retrievedAt, cached: false } };
  } catch {
    return null;
  }
}

async function mapLimit<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await operation(items[index]!);
    }
  });
  await Promise.all(workers);
}

function isNpmName(value: string): boolean {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value) && value.length <= 214;
}

function eolProductFor(name: string): string | null {
  return /\bnode(?:\.js)?\b/i.test(name) ? "nodejs" : null;
}

function releaseCycleFor(releases: unknown[], version: string): Record<string, unknown> | null {
  const major = /^v?(\d+)/.exec(version)?.[1];
  if (!major) return null;
  const found = releases.find((release) => isRecord(release) && String(release.name) === major);
  return isRecord(found) ? found : null;
}

function compareVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match =
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        value,
      );
    return match ? { core: match.slice(1, 4).map(Number), prerelease: match[4] ?? null } : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return left === right ? 0 : null;
  for (let index = 0; index < 3; index++) {
    const difference = a.core[index]! - b.core[index]!;
    if (difference) return Math.sign(difference);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function dedupeSources<T extends { name: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.name, item])).values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
