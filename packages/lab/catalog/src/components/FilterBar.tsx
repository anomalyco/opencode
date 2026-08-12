import type { Facet, FacetSelections, TaxonomyGroup } from "../catalog"
import { label, taxonomyLabel } from "../catalog"
import { FilterMenu } from "./FilterMenu"

const facetOrder: ReadonlyArray<Facet> = ["surface", "pattern", "feature", "state"]

interface FilterBarProps {
  readonly taxonomyName: string
  readonly taxonomy: ReadonlyArray<TaxonomyGroup>
  readonly taxonomyValues: ReadonlyArray<string>
  readonly taxonomyCounts: ReadonlyMap<string, number>
  readonly facetOptions: Readonly<Record<Facet, ReadonlyArray<string>>>
  readonly facets: FacetSelections
  readonly facetCounts: ReadonlyMap<string, number>
  readonly query: string
  readonly resultCount: number
  readonly onTaxonomy: (value: string) => void
  readonly onClearTaxonomy: () => void
  readonly onFacet: (facet: Facet, value: string) => void
  readonly onClearFacet: (facet: Facet) => void
  readonly onClearQuery: () => void
  readonly onClearAll: () => void
}

export function FilterBar({
  taxonomyName,
  taxonomy,
  taxonomyValues,
  taxonomyCounts,
  facetOptions,
  facets,
  facetCounts,
  query,
  resultCount,
  onTaxonomy,
  onClearTaxonomy,
  onFacet,
  onClearFacet,
  onClearQuery,
  onClearAll,
}: FilterBarProps) {
  const selectedFacets = facetOrder.flatMap((facet) => facets[facet].map((value) => ({ facet, value })))
  const hasSelections = query !== "" || taxonomyValues.length > 0 || selectedFacets.length > 0

  return (
    <div className="filter-bar" aria-label="Filters">
      <div className="filter-bar-menus">
        <FilterMenu
          label={taxonomyName}
          searchLabel={`Search ${taxonomyName.toLowerCase()}`}
          groups={taxonomy}
          selected={taxonomyValues}
          counts={taxonomyCounts}
          onToggle={onTaxonomy}
          onClear={onClearTaxonomy}
        />
        {facetOrder.map((facet) => (
          <FilterMenu
            key={facet}
            label={label(facet)}
            searchLabel={`Search ${label(facet).toLowerCase()} filters`}
            groups={[{
              id: facet,
              label: label(facet),
              items: facetOptions[facet]
                .filter((value) => (facetCounts.get(`${facet}:${value}`) ?? 0) > 0 || facets[facet].includes(value))
                .map((value) => ({ id: `${facet}:${value}`, label: label(value) })),
            }]}
            selected={facets[facet].map((value) => `${facet}:${value}`)}
            counts={facetCounts}
            onToggle={(encoded) => onFacet(facet, encoded.slice(facet.length + 1))}
            onClear={() => onClearFacet(facet)}
          />
        ))}
      </div>
      <div className="filter-bar-chips">
        {query ? (
          <button type="button" onClick={onClearQuery} aria-label={`Remove search filter ${query}`}>
            <small>Search</small> {query} <span aria-hidden="true">×</span>
          </button>
        ) : undefined}
        {taxonomyValues.map((value) => (
          <button type="button" key={value} onClick={() => onTaxonomy(value)}>
            {taxonomyLabel(taxonomy, value)} <span aria-hidden="true">×</span>
          </button>
        ))}
        {selectedFacets.map(({ facet, value }) => (
          <button type="button" key={`${facet}:${value}`} onClick={() => onFacet(facet, value)}>
            <small>{label(facet)}</small> {label(value)} <span aria-hidden="true">×</span>
          </button>
        ))}
        {hasSelections ? (
          <button type="button" className="filter-bar-clear" onClick={onClearAll}>
            Clear all
          </button>
        ) : undefined}
      </div>
      <span className="filter-bar-results">{resultCount} {resultCount === 1 ? "result" : "results"}</span>
    </div>
  )
}
