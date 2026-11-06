import { SearchIcon } from "~/component/site/icons"
import { searchLook } from "~/component/site/search-palette"
import { siteSettingsDefaults } from "~/component/site/settings"
import { base } from "../config"

/**
 * The site's ⌘K palette (search-palette.css) with the default look, searching the docs' full text
 * with Pagefind. Hidden until client.ts opens it and fills in the results.
 */
export function DocsSearchDialog() {
  const look = siteSettingsDefaults
  return (
    <div
      data-component="site-search"
      data-style={look.searchStyle}
      data-backdrop={look.searchBackdrop}
      data-tint={look.searchTint}
      data-motion={look.searchMotion}
      style={searchLook(look)}
      data-search-dialog
      data-pagefind-path={`${base}pagefind/pagefind.js`}
      hidden
    >
      <div data-slot="backdrop" aria-hidden="true" />
      <div data-slot="panel" role="dialog" aria-modal="true" aria-label="Search the docs">
        <div data-slot="field">
          <SearchIcon />
          <input
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls="docs-search-results"
            aria-autocomplete="list"
            aria-label="Search"
            placeholder="Search the docs"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="go"
            data-search-input
          />
          <button type="button" data-slot="close" tabindex={-1}>
            <span data-slot="esc">
              <span aria-hidden="true">Esc</span>
              <span data-slot="sr-only">Close search</span>
            </span>
            <span data-slot="cancel">Cancel</span>
          </button>
        </div>
        <div data-slot="results" id="docs-search-results" role="listbox" aria-label="Results">
          <p data-slot="empty" />
        </div>
      </div>
    </div>
  )
}
