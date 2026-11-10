type Connection = { saveData?: boolean; effectiveType?: string }

// Pages already preloaded in this visit, so each destination loads once.
const preloaded = new Set<string>()

/**
 * Touch screens have no hover to tell where the reader is heading, and the router's own touchstart
 * preload never runs (it waits for a mouse button), so the page a link leads to (`accepts` picks
 * which) has its code and strings loaded as soon as a finger lands on the link, each page once.
 * Scrolling past links loads nothing. Not with Save-Data or on a connection slower than 4G, never for
 * the current page, a new-tab, download or language link. Returns a cleanup.
 */
export function preloadTouchedLinks(accepts: (link: HTMLAnchorElement) => boolean, preload: (path: string) => void) {
  const connection = (navigator as Navigator & { connection?: Connection }).connection
  if (connection?.saveData || (connection?.effectiveType && connection.effectiveType !== "4g")) return () => {}
  const touched = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return
    const anchor = (event.target as Element | null)?.closest?.("a[href]")
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return
    if (anchor.hasAttribute("download") || anchor.hasAttribute("hreflang")) return
    const url = new URL(anchor.href)
    if (url.origin !== location.origin || url.pathname === location.pathname || preloaded.has(url.pathname)) return
    if (!accepts(anchor)) return
    preloaded.add(url.pathname)
    preload(url.pathname)
  }
  document.addEventListener("pointerdown", touched, { passive: true })
  return () => document.removeEventListener("pointerdown", touched)
}
