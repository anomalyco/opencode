import type { Ref } from "react"
import type { BrowseMode, Catalog, Variant } from "../catalog"
import { CaptureSetSwitcher } from "./CaptureSetSwitcher"

interface HeaderProps {
  readonly catalog: Catalog
  readonly mode: BrowseMode
  readonly query: string
  readonly resultCount: number
  readonly searchRef: Ref<HTMLInputElement>
  readonly variant: Variant
  readonly onMode: (mode: BrowseMode) => void
  readonly onQuery: (query: string) => void
  readonly onClearSearch: () => void
  readonly onOpenPalette: () => void
  readonly onVariantSelect: (id: string) => void
}

const modes: ReadonlyArray<readonly [BrowseMode, string]> = [
  ["screens", "Screens"],
  ["ui-elements", "UI Elements"],
  ["flows", "Flows"],
]

export function Header({
  catalog,
  mode,
  query,
  resultCount,
  searchRef,
  variant,
  onMode,
  onQuery,
  onClearSearch,
  onOpenPalette,
  onVariantSelect,
}: HeaderProps) {
  const noun = mode === "flows" ? "flows" : "screens"

  return (
    <header className="catalog-header">
      <div className="catalog-brand">
        <strong>Terminal Catalog</strong>
        <span>{resultCount} {noun}</span>
      </div>
      <nav className="catalog-tabs" aria-label="Catalog views">
        {modes.map(([value, title]) => (
          <button
            type="button"
            key={value}
            className={mode === value ? "active" : ""}
            aria-current={mode === value ? "page" : undefined}
            onClick={() => onMode(value)}
          >
            {title}
          </button>
        ))}
      </nav>
      <div className="catalog-tools">
        <CaptureSetSwitcher sets={catalog.variants} active={variant} onSelect={onVariantSelect} />
        <div className="catalog-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            name="catalog-search"
            value={query}
            placeholder={`Search ${noun}`}
            aria-label={`Search ${noun}`}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.blur()
              onClearSearch()
            }}
          />
          <kbd>/</kbd>
        </div>
        <button type="button" className="command-trigger" onClick={onOpenPalette}>
          Explore
          <kbd>⌘K</kbd>
        </button>
      </div>
    </header>
  )
}
