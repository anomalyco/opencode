// The Brand page's drawings (routes/brand/index.tsx), fitted around their labels and kept on whole
// pixels, for the hydrated page and its static render (src/client/islands/brand.ts).

/**
 * Starts what the page does while it is open: while it scrolls, rows passing under a resting pointer
 * would light up one after another (a flicker), so the content ignores the pointer until scrolling
 * has stopped for 150ms; the logos snap to whole pixels as the window resizes; the drawings fit their
 * labels once the fonts have loaded. Returns what stops it.
 */
export function startDrawings() {
  const state: { idle?: ReturnType<typeof setTimeout> } = {}
  // Written once per scroll, not per event: it restyles the whole page.
  const scrolling = () => {
    if (state.idle === undefined) document.documentElement.dataset.scrolling = ""
    clearTimeout(state.idle)
    state.idle = setTimeout(() => {
      state.idle = undefined
      delete document.documentElement.dataset.scrolling
    }, 150)
  }
  window.addEventListener("scroll", scrolling, { passive: true })
  const observer = new ResizeObserver(snapLogos)
  observer.observe(document.documentElement)
  void document.fonts.ready.then(() => {
    fitDrawings()
    snapLogos()
  })
  return () => {
    window.removeEventListener("scroll", scrolling)
    clearTimeout(state.idle)
    delete document.documentElement.dataset.scrolling
    observer.disconnect()
  }
}

/**
 * Widens each annotated drawing's viewBox (and its size, so it keeps 1:1) to take in its labels, whose
 * length depends on the language and the font: an <svg> clips anything outside its viewBox. The clear-
 * space drawings grow on both sides by the same amount, so the logo stays on the figure's centre line.
 */
export function fitDrawings() {
  document
    .querySelectorAll<SVGSVGElement>(
      '[data-page="brand"] :is(svg[data-component="clear-space"], svg[data-component="pixel-grid"])',
    )
    .forEach((svg) => {
      const original = (svg.dataset.viewBox ??= svg.getAttribute("viewBox") ?? "").split(" ").map(Number)
      const texts = [...svg.querySelectorAll<SVGTextElement>("text")].map((text) => text.getBBox())
      if (original.length !== 4 || texts.every((box) => box.width === 0)) return
      const pad = 2
      const left = Math.max(0, ...texts.map((box) => original[0] - box.x + pad))
      const right = Math.max(0, ...texts.map((box) => box.x + box.width - (original[0] + original[2]) + pad))
      const top = Math.max(0, ...texts.map((box) => original[1] - box.y + pad))
      const bottom = Math.max(0, ...texts.map((box) => box.y + box.height - (original[1] + original[3]) + pad))
      const symmetric = svg.dataset.component === "clear-space"
      const grow = {
        left: Math.ceil(symmetric ? Math.max(left, right) : left),
        right: Math.ceil(symmetric ? Math.max(left, right) : right),
        top: Math.ceil(top),
        bottom: Math.ceil(bottom),
      }
      const box = [
        original[0] - grow.left,
        original[1] - grow.top,
        original[2] + grow.left + grow.right,
        original[3] + grow.top + grow.bottom,
      ]
      svg.setAttribute("viewBox", box.join(" "))
      svg.setAttribute("width", String(box[2]))
      svg.setAttribute("height", String(box[3]))
    })
}

/**
 * Nudges every logo on the page onto whole pixels. Sizes are whole-pixel steps already; centering and the
 * text above can still leave a fractional offset, so each logo is translated by the remainder.
 */
export function snapLogos() {
  const logos = [
    ...document.querySelectorAll<HTMLElement | SVGSVGElement>(
      '[data-page="brand"] :is([data-slot="preview"] img, svg[data-slot="mark"], svg[data-slot="wordmark"], [data-component="clear-space"], [data-component="pixel-grid"])',
    ),
  ]
  logos.forEach((logo) => (logo.style.translate = ""))
  const rects = logos.map((logo) => logo.getBoundingClientRect())
  logos.forEach((logo, index) => {
    const dx = Math.round(rects[index].x) - rects[index].x
    const dy = Math.round(rects[index].y) - rects[index].y
    if (dx || dy) logo.style.translate = `${dx}px ${dy}px`
  })
}
