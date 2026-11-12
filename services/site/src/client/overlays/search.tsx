import { Router } from "@solidjs/router"
import { LanguageProvider } from "~/context/language"
import { I18nProvider } from "~/context/i18n"
import { searchAnnouncement, type SearchVia } from "~/component/site/search"
import { $, site } from "../dom"
import { mount } from "../solid"
import { isDark, setTheme } from "../theme"

/**
 * The site's search palette on a static page, rendered on first intent (entry.ts) and then left to
 * handle ⌘K itself, as on the hydrated pages; `pending` names a shortcut pressed while it loaded, which
 * opens it. Its results open with a whole page load. The router is there for the palette's own reads
 * of the address; it has no routes.
 */
export default async function mountSearch(pending: { via?: SearchVia }) {
  // Through import(), so its strings in the page's language load with it (script/i18n-plugin.ts).
  const { SearchPalette } = await import("~/component/site/search-palette")
  const host = document.createElement("div")
  host.style.display = "contents"
  site.append(host)
  // The live region the palette announces into (search.tsx), now with its text.
  $('[data-slot="search-status"]')?.remove()
  return mount(
    () => (
      <Router
        explicitLinks={true}
        root={() => (
          <LanguageProvider>
            <I18nProvider>
              <span data-slot="search-status" aria-live="polite" role="status">
                {searchAnnouncement()}
              </span>
              <SearchPalette
                openOnMount={pending.via}
                onToggleTheme={() => setTheme(isDark() ? "light" : "dark")}
                go={(href) => location.assign(href)}
              />
            </I18nProvider>
          </LanguageProvider>
        )}
      />
    ),
    host,
  )
}
