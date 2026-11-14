// The Console landing backdrop (dev.opencode.ai/console, preset "vertical" with dots): 2px dots
// where columns cross rows. Gaps are 24px at the centre and tighten to 8px at the edges
// ("diverge", curve exponent 0.8), across and down. Every fourth column is an accent. The dots are
// drawn once into a mask, so their colour and opacity come from CSS and follow the theme. No
// framework code: ConsoleField (console-field.tsx) and the static pages' script both draw with it.
const spacing = 8
const widest = 24
const accentEvery = 4
const baseAlpha = 0.6

/**
 * Draws the dots into `element`'s mask (--console-dots) at its size once it comes within half a
 * window of the screen, again as it resizes, with dots `dot()` CSS pixels wide; marks it
 * data-visible while on screen and data-entered once a quarter of it has been. Returns a redraw
 * (for a new dot size) and a stop.
 */
export function consoleDots(element: HTMLElement, dot: () => number) {
  const canvas = document.createElement("canvas")
  const draw = () => {
    const width = element.clientWidth
    const height = element.clientHeight
    const context = canvas.getContext("2d")
    if (!context || width < 1 || height < 1) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    context.clearRect(0, 0, canvas.width, canvas.height)
    const rows = positions(height).map((row) => Math.round((row.at - dot() / 2) * dpr))
    positions(width).forEach((column) => {
      context.globalAlpha = ((column.index % accentEvery) + accentEvery) % accentEvery === 0 ? 1 : baseAlpha
      const x = Math.round((column.at - dot() / 2) * dpr)
      rows.forEach((y) =>
        context.fillRect(x, y, Math.max(1, Math.round(dot() * dpr)), Math.max(1, Math.round(dot() * dpr))),
      )
    })
    element.style.setProperty("--console-dots", `url(${canvas.toDataURL()})`)
    element.dataset.ready = ""
  }
  // The first draw is the resize observer's first callback, after layout and before the frame
  // paints, so starting neither forces a layout nor draws and encodes the mask twice.
  const resize = new ResizeObserver(draw)
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      near.disconnect()
      resize.observe(element)
    },
    { rootMargin: "50% 0px" },
  )
  near.observe(element)
  const view = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1)
      if (!entry) return
      element.toggleAttribute("data-visible", entry.isIntersecting)
      if (entry.intersectionRatio >= 0.25) element.dataset.entered = ""
    },
    { threshold: [0, 0.25] },
  )
  view.observe(element)
  return {
    draw,
    stop: () => {
      near.disconnect()
      resize.disconnect()
      view.disconnect()
    },
  }
}

// Walks out from the centre a pixel at a time, adding a line each time the running sum of
// 1 / gap passes a whole number, the same as the landing page's "diverge" curve.
function positions(length: number) {
  const centre = length / 2
  const half = Math.max(1, centre)
  const gap = (at: number) => widest - (widest - spacing) * Math.min(1, Math.abs(at - centre) / half) ** 0.8
  const walk = (direction: 1 | -1) => {
    const lines: { at: number; index: number }[] = []
    let next = 1
    let total = 0
    for (let at = centre; direction > 0 ? at < length : at > 0; at += direction) {
      const end = total + 1 / gap(at + direction / 2)
      for (; next <= end; next += 1)
        lines.push({ at: at + direction * ((next - total) / (end - total)), index: next * direction })
      total = end
    }
    return lines
  }
  return [{ at: centre, index: 0 }, ...walk(1), ...walk(-1)]
}
