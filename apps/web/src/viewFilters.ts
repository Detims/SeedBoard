import type { Component, Documentation, Suggestion } from "@modernizer/contracts";

export type SuggestionCategoryFilter = Suggestion["category"] | "all";

export function filterDocumentationComponents(
  components: readonly Component[],
  documentation: readonly Documentation[],
  query: string,
): Component[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...components];

  const documentationByComponent = new Map(
    documentation.map((record) => [record.componentId, record]),
  );
  return components.filter((component) => {
    const record = documentationByComponent.get(component.id);
    const searchableFields = [
      component.name,
      component.kind,
      component.layer,
      component.locator,
      ...component.versions.flatMap(({ facet, value }) => [facet, value]),
      record?.status,
      record?.gap,
      ...(record?.officialReferences ?? []).flatMap(({ title, url, verifiedAt }) => [
        title,
        url,
        verifiedAt ?? "",
      ]),
      ...(record?.internalPaths ?? []),
    ];
    return searchableFields
      .filter((field): field is string => typeof field === "string")
      .some((field) => field.toLocaleLowerCase().includes(normalizedQuery));
  });
}

export function filterSuggestionsByCategory(
  suggestions: readonly Suggestion[],
  category: SuggestionCategoryFilter,
): Suggestion[] {
  return category === "all"
    ? [...suggestions]
    : suggestions.filter((suggestion) => suggestion.category === category);
}
