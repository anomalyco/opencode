type Connection = { saveData?: boolean; effectiveType?: string }

// Pages already preloaded in this visit, so each destination loads once.
const preloaded = new Set<string>()

/**
 * Touch screens have no hover to tell where the reader is heading, so once the page is idle, each
 * page a link on screen leads to (`accepts` picks which) has its code and strings loaded as the link
 * scrolls into view, each page once. Not with Save-Data or on a connection slower than 4G, never for
 * the current page, a new-tab, download or language link. Returns a cleanup.
 */
export function preloadVisibleLinks(accepts: (link: HTMLAnchorElement) => boolean, preload: (path: string) => void) {
  const connection = (navigator as Navigator & { connection?: Connection }).connection
  if (!matchMedia("(hover: none)").matches) return () => {}
  if (connection?.saveData || (connection?.effectiveType && connection.effectiveType !== "4g")) return () => {}
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLAnchorElement)) return
        observer.unobserve(entry.target)
        const path = new URL(entry.target.href).pathname
        if (preloaded.has(path) || path === location.pathname) return
        preloaded.add(path)
        preload(path)
      }),
    { rootMargin: "100px 0px" },
  )
  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
  let stopped = false
  idle(() => {
    if (stopped) return
    document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      if (anchor.target || anchor.hasAttribute("download") || anchor.hasAttribute("hreflang")) return
      const url = new URL(anchor.href)
      if (url.origin !== location.origin || url.pathname === location.pathname || !accepts(anchor)) return
      observer.observe(anchor)
    })
  })
  return () => {
    stopped = true
    observer.disconnect()
  }
}
