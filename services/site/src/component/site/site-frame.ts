// The frame around every page (Site, site.tsx), with no Solid, so the hydrated pages, the static
// pages (src/client/footer.ts) and the docs (src/docs/client.ts) share it. Each returns the function
// that stops it.

/**
 * The fixed sidebar nav steps aside (`away`) once the footer's own list scrolls up into its space,
 * so the two never overlap, and comes back as the footer leaves.
 */
export function watchNavAway(nav: HTMLElement, footer: HTMLElement, away: (away: boolean) => void) {
  let observer: IntersectionObserver | undefined
  const watch = () => {
    observer?.disconnect()
    const clear = innerHeight - nav.getBoundingClientRect().bottom - 24
    observer = new IntersectionObserver(([entry]) => away(entry.isIntersecting), {
      rootMargin: `0px 0px ${-Math.max(0, clear)}px 0px`,
    })
    observer.observe(footer)
  }
  watch()
  addEventListener("resize", watch, { passive: true })
  return () => {
    observer?.disconnect()
    removeEventListener("resize", watch)
  }
}

/**
 * The content above the footer has fluid heights (wrapping text, media sized by width), so the theme
 * switch often lands between device pixels and its thin icon strokes blur at 1x: this moves it back
 * onto the pixel grid whenever the page's size changes.
 */
export function keepOnPixels(element: HTMLElement) {
  let frame = 0
  const snap = () => {
    frame = 0
    element.style.translate = ""
    const rect = element.getBoundingClientRect()
    const shift = (value: number) =>
      (Math.round(value * devicePixelRatio) - value * devicePixelRatio) / devicePixelRatio
    const x = shift(rect.left)
    const y = shift(rect.top)
    if (Math.abs(x) > 0.001 || Math.abs(y) > 0.001) element.style.translate = `${x}px ${y}px`
  }
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(snap)
  })
  observer.observe(document.body)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}

/**
 * A page's own nav (the docs nav) scrolls in its own box under the fixed logo and lockup. It holds
 * the wheel only while it has something to scroll (data-scrolls, site.css), fades out at an edge only
 * while items pass under it (data-fade-top, data-fade-bottom), and starts with the current page in view.
 */
export function sectionNavScroll(nav: HTMLElement) {
  const update = () => {
    nav.toggleAttribute("data-scrolls", nav.scrollHeight > nav.clientHeight)
    nav.toggleAttribute("data-fade-top", nav.scrollTop > 0)
    nav.toggleAttribute("data-fade-bottom", nav.scrollTop + nav.clientHeight < nav.scrollHeight - 1)
  }
  const current = nav.querySelector<HTMLElement>('[aria-current="page"]')
  if (current && current.offsetTop + current.offsetHeight > nav.clientHeight)
    nav.scrollTop = current.offsetTop - nav.clientHeight / 2
  const resize = new ResizeObserver(update)
  ;[nav, ...nav.children].forEach((element) => resize.observe(element))
  nav.addEventListener("scroll", update, { passive: true })
  update()
  return () => {
    resize.disconnect()
    nav.removeEventListener("scroll", update)
  }
}
