import { For, Show } from "solid-js"
import { base } from "../../config"
import { docsHref, docsSections, getDocsSection } from "../../lib/navigation"

// Search, the theme toggle and the ⌘K shortcut work through the layout's head script and client.ts.
export function DocsHeader(props: { currentSlug: string }) {
  const currentSection = getDocsSection(props.currentSlug)
  const searchEnabled = import.meta.env.PROD
  return (
    <>
      <header class="site-header">
        <div class="header-inner">
          <a class="brand" href={docsHref("index")} aria-label="OpenCode docs home">
            <img class="logo-dark" src={`${base}assets/logo-dark.svg`} alt="OpenCode" />
            <img class="logo-light" src={`${base}assets/logo-light.svg`} alt="OpenCode" />
          </a>
          <nav aria-label="Documentation sections">
            <For each={docsSections}>
              {(section) => (
                <a
                  href={docsHref(section.landingSlug)}
                  aria-current={currentSection.key === section.key ? "page" : undefined}
                >
                  {section.title}
                </a>
              )}
            </For>
            {/* The V1 docs app, through the site's /v1/docs redirect (src/middleware.ts). */}
            <a href="/v1/docs">V1</a>
          </nav>
          <div class="header-spacer"></div>
          <Show when={searchEnabled}>
            <button class="search-trigger" type="button" data-search-open aria-label="Search documentation">
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
          </Show>
          <button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle color theme">
            <svg
              class="theme-icon-light"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
            <svg
              class="theme-icon-dark"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
            </svg>
          </button>
          <a class="github-link" href="https://github.com/anomalyco/opencode" aria-label="OpenCode on GitHub">
            GitHub
          </a>
        </div>
      </header>
      <Show when={searchEnabled}>
        <dialog
          class="search-dialog"
          data-search-dialog
          data-pagefind-path={`${base}pagefind/pagefind.js`}
          data-base-url={base}
          aria-label="Search documentation"
        >
          <form method="dialog" class="search-bar">
            <span aria-hidden="true">&gt;</span>
            <input
              data-search-input
              type="search"
              placeholder="Search docs"
              aria-label="Search docs"
              autocomplete="off"
            />
            <button type="submit" aria-label="Close search">
              Esc
            </button>
          </form>
          <div class="search-results" data-search-results>
            <p>Start typing to search the documentation.</p>
          </div>
        </dialog>
      </Show>
    </>
  )
}
