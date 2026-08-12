import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { useEffect, useRef, useState } from "react"
import type { Catalog, CatalogSelections, Facet, FacetIndex, Filter, Taxonomy } from "../catalog"
import { label, taxonomyLabel } from "../catalog"

interface CommandResult {
  readonly key: string
  readonly group: string
  readonly label: string
  readonly meta: string
  readonly selected?: boolean
  readonly run: () => void
}

interface CommandPaletteProps {
  readonly catalog: Catalog
  readonly facetIndex: FacetIndex
  readonly selections: CatalogSelections
  readonly onClose: () => void
  readonly onFacet: (filter: Filter) => void
  readonly onTaxonomy: (taxonomy: Taxonomy, value: string) => void
  readonly onScreen: (id: string) => void
  readonly onFlow: (id: string) => void
}

const groupOrder = [
  "Actions",
  "Screen labels",
  "UI Elements",
  "Surfaces",
  "Patterns",
  "Features",
  "States",
  "Flows",
  "Screens",
]

export function CommandPalette({
  catalog,
  facetIndex,
  selections,
  onClose,
  onFacet,
  onTaxonomy,
  onScreen,
  onFlow,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const results = buildResults({
    catalog,
    facetIndex,
    selections,
    query,
    onFacet,
    onTaxonomy,
    onScreen,
    onFlow,
  })
  const activeIndex = Math.min(index, Math.max(0, results.length - 1))
  const activeResult = results[activeIndex]
  const activeId = activeResult ? `command-${activeResult.key}` : undefined

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" })
  }, [activeId])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (results.length === 0) return
      const direction = event.key === "ArrowDown" ? 1 : -1
      setIndex((activeIndex + direction + results.length) % results.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      activeResult?.run()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="command-dialog"
      aria-label="Explore catalog"
      closedby="any"
      onKeyDown={handleKeyDown}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="command-input-row">
        <input
          value={query}
          placeholder="Search screens, UI elements, labels, and flows"
          aria-label="Search catalog"
          aria-activedescendant={activeId}
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="command-results" role="listbox" aria-label="Catalog results">
        {results.length === 0 ? (
          <p className="command-empty">No matching screens.</p>
        ) : (
          groupOrder.map((group) => {
            const grouped = results.filter((result) => result.group === group)
            if (grouped.length === 0) return undefined
            return (
              <section key={group} className="command-group">
                <h2>{group}</h2>
                {grouped.map((result) => {
                  const resultIndex = results.indexOf(result)
                  const isActive = resultIndex === activeIndex
                  return (
                    <button
                      key={result.key}
                      id={`command-${result.key}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`command-result${isActive ? " active" : ""}${result.selected ? " selected" : ""}`}
                      onClick={result.run}
                      onPointerEnter={() => setIndex(resultIndex)}
                    >
                      <span>
                        {result.label}
                        {result.selected ? <span className="command-selected">✓ selected</span> : undefined}
                      </span>
                      <small>{result.meta}</small>
                    </button>
                  )
                })}
              </section>
            )
          })
        )}
      </div>
      <p className="command-hint">Filters stack as you select them. Select one again to remove it.</p>
    </dialog>
  )
}

interface BuildResultsInput {
  readonly catalog: Catalog
  readonly facetIndex: FacetIndex
  readonly selections: CatalogSelections
  readonly query: string
  readonly onFacet: (filter: Filter) => void
  readonly onTaxonomy: (taxonomy: Taxonomy, value: string) => void
  readonly onScreen: (id: string) => void
  readonly onFlow: (id: string) => void
}

function buildResults({
  catalog,
  facetIndex,
  selections,
  query,
  onFacet,
  onTaxonomy,
  onScreen,
  onFlow,
}: BuildResultsInput): ReadonlyArray<CommandResult> {
  const needle = query.trim().toLowerCase()
  const matches = (...values: ReadonlyArray<string>) =>
    needle === "" || values.join(" ").toLowerCase().includes(needle)
  const results: Array<CommandResult> = []

  for (const group of catalog.screenTaxonomy) {
    for (const item of group.items) {
      if (!matches(group.label, item.label)) continue
      const total = catalog.screens.filter((screen) => screen.screenLabels.includes(item.id)).length
      results.push({
        key: `screen-label:${item.id}`,
        group: "Screen labels",
        label: item.label,
        meta: count(total, "screen"),
        selected: selections.screenLabels.includes(item.id),
        run: () => onTaxonomy("screen", item.id),
      })
    }
  }

  for (const group of catalog.uiElementTaxonomy) {
    for (const item of group.items) {
      if (!matches(group.label, item.label)) continue
      const total = catalog.screens.filter((screen) => screen.uiElements.includes(item.id)).length
      results.push({
        key: `ui-element:${item.id}`,
        group: "UI Elements",
        label: item.label,
        meta: count(total, "screen"),
        selected: selections.uiElements.includes(item.id),
        run: () => onTaxonomy("ui-element", item.id),
      })
    }
  }

  const facetGroups: ReadonlyArray<readonly [Facet, string, ReadonlyArray<string>]> = [
    ["surface", "Surfaces", catalog.surfaces],
    ["pattern", "Patterns", catalog.patterns],
    ["feature", "Features", catalog.features],
    ["state", "States", catalog.states],
  ]
  for (const [facet, group, values] of facetGroups) {
    for (const value of values) {
      if (!matches(value, label(value))) continue
      results.push({
        key: `${facet}:${value}`,
        group,
        label: label(value),
        meta: count(facetIndex.get(facet)?.get(value)?.size ?? 0, "screen"),
        selected: selections.facets[facet].includes(value),
        run: () => onFacet({ facet, value }),
      })
    }
  }

  for (const screen of catalog.screens) {
    if (!matches(screen.title, screen.category, ...screen.tags)) continue
    results.push({
      key: `screen:${screen.id}`,
      group: "Screens",
      label: screen.title,
      meta: screen.screenLabels.map((value) => taxonomyLabel(catalog.screenTaxonomy, value)).join(" · "),
      run: () => onScreen(screen.id),
    })
  }

  for (const flow of catalog.flows) {
    if (!matches(flow.title, flow.group, flow.description)) continue
    results.push({
      key: `flow:${flow.id}`,
      group: "Flows",
      label: flow.title,
      meta: `${flow.steps.length} ${flow.steps.length === 1 ? "screen" : "screens"}`,
      run: () => onFlow(flow.id),
    })
  }

  return results
}

function count(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? "" : "s"}`
}
