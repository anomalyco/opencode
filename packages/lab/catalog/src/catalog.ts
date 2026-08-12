import type { Catalog, Flow, FlowStep, Frame, Screen, TaxonomyGroup, TaxonomyItem, Variant } from "../catalog/schema"

export type { Catalog, Flow, FlowStep, Frame, Screen, TaxonomyGroup, TaxonomyItem, Variant }

export type Facet = "surface" | "pattern" | "feature" | "state"
export type BrowseMode = "screens" | "ui-elements" | "flows"
export type Taxonomy = "screen" | "ui-element"

export interface Filter {
  readonly facet: Facet
  readonly value: string
}

export type FacetSelections = Readonly<Record<Facet, ReadonlyArray<string>>>

export interface CatalogSelections {
  readonly screenLabels: ReadonlyArray<string>
  readonly uiElements: ReadonlyArray<string>
  readonly facets: FacetSelections
}

export function frameFor(screen: Screen, variantId: string): Frame | undefined {
  return screen.frames.find((frame) => frame.variantId === variantId)
}

const rendererFamilies = ["notification", "shell", "patch", "read", "web", "search", "question", "subagent", "assistant"]

export function screenFamily(screen: Screen): string {
  return rendererFamilies.find((family) => screen.features.includes(family)) ?? screen.category
}

export const emptyFacetSelections: FacetSelections = {
  surface: [],
  pattern: [],
  feature: [],
  state: [],
}

export function label(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function taxonomyLabel(groups: ReadonlyArray<TaxonomyGroup>, id: string): string {
  for (const group of groups) {
    const item = group.items.find((candidate) => candidate.id === id)
    if (item) return item.label
  }
  return label(id)
}

export function facetValues(screen: Screen, facet: Facet): ReadonlyArray<string> {
  if (facet === "surface") return screen.surfaces
  if (facet === "pattern") return screen.patterns
  if (facet === "feature") return screen.features
  return screen.states
}

export type FacetIndex = ReadonlyMap<Facet, ReadonlyMap<string, ReadonlySet<string>>>

export function buildFacetIndex(screens: ReadonlyArray<Screen>): FacetIndex {
  const index = new Map<Facet, Map<string, Set<string>>>([
    ["surface", new Map()],
    ["pattern", new Map()],
    ["feature", new Map()],
    ["state", new Map()],
  ])
  for (const screen of screens) {
    for (const [facet, values] of index) {
      for (const value of facetValues(screen, facet)) {
        const ids = values.get(value)
        if (ids) ids.add(screen.id)
        else values.set(value, new Set([screen.id]))
      }
    }
  }
  return index
}

export function filterScreens(
  screens: ReadonlyArray<Screen>,
  query: string,
  mode: BrowseMode,
  selections: CatalogSelections,
): ReadonlyArray<Screen> {
  const needle = query.trim().toLowerCase()
  const taxonomyValues = new Set(mode === "screens" ? selections.screenLabels : selections.uiElements)
  const selectedFacets = (Object.keys(selections.facets) as ReadonlyArray<Facet>).map(
    (facet) => [facet, new Set(selections.facets[facet])] as const,
  )

  return screens.filter((screen) => {
    if (mode !== "flows" && taxonomyValues.size > 0) {
      const values = mode === "screens" ? screen.screenLabels : screen.uiElements
      if (!values.some((value) => taxonomyValues.has(value))) return false
    }

    for (const [facet, selected] of selectedFacets) {
      if (selected.size > 0 && !facetValues(screen, facet).some((value) => selected.has(value))) {
        return false
      }
    }

    if (needle === "") return true
    return [
      screen.title,
      screen.category,
      ...screen.tags,
      ...screen.screenLabels,
      ...screen.uiElements,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  })
}

export function filterFlows(flows: ReadonlyArray<Flow>, query: string): ReadonlyArray<Flow> {
  const needle = query.trim().toLowerCase()
  if (needle === "") return flows
  return flows.filter((flow) =>
    [flow.title, flow.group, flow.description, ...flow.steps.flatMap((step) => [step.title, step.trigger ?? ""])]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  )
}
