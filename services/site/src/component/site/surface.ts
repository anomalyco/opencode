/**
 * Keeps fixed marks (the GitHub mark, the product chevrons, the /font logo) readable over whatever scrolls under
 * them: each gets `data-on-surface="dark"` or `"light"` from what is behind its centre, and CSS
 * gives it that colour scheme, so its light-dark() colours switch to the matching artwork at once.
 * Behind it means the first element under the mark that says what it is: `data-surface` on it or an
 * ancestor (for media and canvases), else its own background colour (an SVG shape's fill) when
 * mostly opaque. Nothing
 * decisive (the page itself) leaves the attribute off, so the page theme decides.
 */
export function watchSurfaces(marks: () => HTMLElement[]) {
  const check = () =>
    marks().forEach((mark) => {
      const rect = mark.getBoundingClientRect()
      if (rect.width === 0) return
      // The centre and four points around it: over a glyph's edge, what most of the mark covers.
      const votes = [
        [0.5, 0.5],
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ].map(([x, y]) => surfaceAt(mark, rect.left + rect.width * x, rect.top + rect.height * y))
      const dark = votes.filter((vote) => vote === "dark").length
      const light = votes.filter((vote) => vote === "light").length
      const surface = dark === light ? votes[0] : dark > light ? "dark" : "light"
      if (surface) mark.dataset.onSurface = surface
      if (!surface) delete mark.dataset.onSurface
    })
  const frame = { id: 0 }
  const schedule = () => {
    if (frame.id) return
    frame.id = requestAnimationFrame(() => {
      frame.id = 0
      check()
    })
  }
  check()
  window.addEventListener("scroll", schedule, { passive: true })
  window.addEventListener("resize", schedule)
  // Pinned stages and the film change under a still mark too.
  const timer = setInterval(schedule, 400)
  return () => {
    cancelAnimationFrame(frame.id)
    clearInterval(timer)
    window.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", schedule)
  }
}

function surfaceAt(mark: HTMLElement, x: number, y: number) {
  for (const element of document.elementsFromPoint(x, y)) {
    if (mark.contains(element) || element.closest("[data-on-surface]") === mark) continue
    const marked = element.closest<HTMLElement>("[data-surface]")?.dataset.surface
    if (marked === "dark" || marked === "light") return marked
    // Drawn shapes (the big glyphs) count by their fill, boxes by their background.
    const style = getComputedStyle(element)
    const color = channels(element instanceof SVGGeometryElement ? style.fill : style.backgroundColor)
    if (!color || color.alpha < 0.5) continue
    // Relative luminance, roughly: dark below the mid grey.
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b < 0.45 ? "dark" : "light"
  }
  return undefined
}

// rgb()/rgba() (0–255) or color(srgb …) (0–1), as computed styles give colours; 0–1 channels.
function channels(value: string) {
  const numbers = value.match(/[\d.]+/g)?.map(Number)
  if (!numbers || numbers.length < 3) return undefined
  const scale = value.startsWith("color(") ? 1 : 255
  return { r: numbers[0] / scale, g: numbers[1] / scale, b: numbers[2] / scale, alpha: numbers[3] ?? 1 }
}
