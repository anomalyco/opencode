import { useEffect, useRef, useState } from "react"
import type { TaxonomyGroup } from "../catalog"

interface FilterMenuProps {
  readonly label: string
  readonly searchLabel: string
  readonly groups: ReadonlyArray<TaxonomyGroup>
  readonly selected: ReadonlyArray<string>
  readonly counts?: ReadonlyMap<string, number>
  readonly onToggle: (value: string) => void
  readonly onClear: () => void
}

export function FilterMenu({ label, searchLabel, groups, selected, counts, onToggle, onClear }: FilterMenuProps) {
  const [query, setQuery] = useState("")
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const searchable = groups.reduce((total, group) => total + group.items.length, 0) > 7
  const needle = query.trim().toLowerCase()
  const selectedValues = new Set(selected)
  const visibleGroups: Array<TaxonomyGroup> = []
  for (const group of groups) {
    const items = group.items.filter((item) =>
      needle === "" ? true : `${group.label} ${item.label}`.toLowerCase().includes(needle),
    )
    if (items.length > 0) visibleGroups.push({ ...group, items })
  }

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const details = detailsRef.current
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      const details = detailsRef.current
      if (event.key !== "Escape" || !details?.open) return
      event.preventDefault()
      event.stopPropagation()
      details.open = false
      details.querySelector<HTMLElement>("summary")?.focus()
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", closeOnEscape, true)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", closeOnEscape, true)
    }
  }, [])

  return (
    <details className="filter-menu" ref={detailsRef}>
      <summary>
        <span>{label}</span>
        {selected.length > 0 ? <span className="filter-count">{selected.length}</span> : undefined}
        <span className="filter-chevron" aria-hidden="true">
          ↓
        </span>
      </summary>
      <div className="filter-popover">
        {searchable ? (
          <div className="filter-search">
            <span aria-hidden="true">⌕</span>
            <input
              name={`${label.toLowerCase().replaceAll(" ", "-")}-search`}
              value={query}
              placeholder={searchLabel}
              aria-label={searchLabel}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : undefined}
        <div className="filter-options">
          {visibleGroups.length === 0 ? (
            <p className="filter-empty">No matching labels.</p>
          ) : (
            visibleGroups.map((group) => (
              <section className="filter-group" key={group.id}>
                {groups.length > 1 ? <h2>{group.label}</h2> : undefined}
                {group.items.map((item) => (
                  <label key={item.id} className="filter-option">
                    <input type="checkbox" checked={selectedValues.has(item.id)} onChange={() => onToggle(item.id)} />
                    <span>{item.label}</span>
                    {counts ? <small>{counts.get(item.id) ?? 0}</small> : undefined}
                  </label>
                ))}
              </section>
            ))
          )}
        </div>
        {selected.length > 0 ? (
          <button type="button" className="filter-clear" onClick={onClear}>
            Clear {selected.length} selected
          </button>
        ) : undefined}
      </div>
    </details>
  )
}
