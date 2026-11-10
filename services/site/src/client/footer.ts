import { watchSurfaces } from "~/component/site/surface"
import { $, $$ } from "./dom"

// The frame around every static page: the sidebar nav that steps aside for the footer's list, the
// GitHub mark that switches to the artwork for what scrolls under it, and the theme switch kept on
// whole pixels. Site (component/site/site.tsx) does the same on the hydrated pages.

export function startFrame() {
  // The fixed sidebar nav fades out (data-away, and inert) once the footer's own list scrolls up into
  // its space, so the two never overlap; it comes back as the footer leaves.
  const nav = $('[data-component="nav"]')
  const footer = $('[data-component="secondary-nav"]')
  if (nav && footer) {
    let observer: IntersectionObserver | undefined
    const watch = () => {
      observer?.disconnect()
      const clear = innerHeight - nav.getBoundingClientRect().bottom - 24
      observer = new IntersectionObserver(
        ([entry]) => {
          nav.toggleAttribute("data-away", entry.isIntersecting)
          nav.inert = entry.isIntersecting
        },
        { rootMargin: `0px 0px ${-Math.max(0, clear)}px 0px` },
      )
      observer.observe(footer)
    }
    watch()
    addEventListener("resize", watch, { passive: true })
  }

  watchSurfaces(() =>
    $$(
      '[data-component="github-link"], [data-component="product-cycle"], [data-component="bare-chrome"] > [data-slot="logo"]',
    ),
  )

  // Fluid heights above the footer often leave the theme switch between device pixels, which blurs
  // its thin strokes at 1x: move it back onto the pixel grid whenever the page's size changes.
  $$('[data-component="theme-toggle"]').forEach((toggle) => {
    let frame = 0
    const snap = () => {
      frame = 0
      toggle.style.translate = ""
      const rect = toggle.getBoundingClientRect()
      const shift = (value: number) =>
        (Math.round(value * devicePixelRatio) - value * devicePixelRatio) / devicePixelRatio
      const x = shift(rect.left)
      const y = shift(rect.top)
      if (Math.abs(x) > 0.001 || Math.abs(y) > 0.001) toggle.style.translate = `${x}px ${y}px`
    }
    new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(snap)
    }).observe(document.body)
  })
}
