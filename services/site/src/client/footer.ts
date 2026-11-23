import { keepOnPixels, watchNavAway } from "~/component/site/site-frame"
import { watchSurfaces } from "~/component/site/surface"
import { $, $$ } from "./dom"

// The frame around every static page (site-frame.ts), as Site (component/site/site.tsx) runs it on
// the hydrated pages: the sidebar nav that steps aside for the footer's list (and leaves the tab
// order), the GitHub mark that switches to the artwork for what scrolls under it, and the theme
// switch kept on whole pixels.

export function startFrame() {
  const nav = $('[data-component="nav"]')
  const footer = $('[data-component="secondary-nav"]')
  if (nav && footer)
    watchNavAway(nav, footer, (away) => {
      nav.toggleAttribute("data-away", away)
      nav.inert = away
    })

  watchSurfaces(() =>
    $$(
      '[data-component="github-link"], [data-component="product-cycle"], [data-component="bare-chrome"] > [data-slot="logo"]',
    ),
  )

  $$('[data-component="theme-toggle"]').forEach((toggle) => keepOnPixels(toggle))
}
