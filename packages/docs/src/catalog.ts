/** Small, reviewed index of official documentation entry points. These links are
 * curated by package identity; they are not version compatibility checks. */
export const officialPackageDocs: Record<string, { title: string; url: string }> = {
  express: { title: "Express documentation", url: "https://expressjs.com/en/guide/" },
  pg: { title: "node-postgres documentation", url: "https://node-postgres.com/" },
  prettier: { title: "Prettier documentation", url: "https://prettier.io/docs/" },
  react: { title: "React documentation", url: "https://react.dev/learn" },
  typescript: {
    title: "TypeScript Handbook",
    url: "https://www.typescriptlang.org/docs/handbook/",
  },
  vite: { title: "Vite documentation", url: "https://vite.dev/guide/" },
  vitest: { title: "Vitest documentation", url: "https://vitest.dev/guide/" },
};

export function packageNameFromLocator(locator: string): string | null {
  const marker = "node_modules/";
  const index = locator.lastIndexOf(marker);
  if (index < 0) return null;
  const parts = locator.slice(index + marker.length).split("/");
  if (parts[0]?.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}
