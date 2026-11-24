import "./reveal.css"
import { inView, washRootMargin, washStartTime, washThreshold } from "./entrance"
import type { logoAnimations, SiteSettings } from "./settings"

/**
 * The reveal styles shared by the logo row, the contributor avatars and the tool tiles (Settings ›
 * Logo, Avatar and Tools animation). A container with `data-reveal` and `data-animation` holds
 * items marked `data-slot="brand"` (the part that animates, with `data-state="in"` or `"out"`)
 * around a `data-slot="mark"` (the artwork, which some styles clip). revealMotion gives the
 * container the timing and each style's variables; an item can set its own `--logo-delay`. While
 * the container has `data-armed`, items without a state wait unseen. No framework code, so the
 * static pages' script uses it too (src/client/islands/home.ts); use-wash.ts is the app's wash.
 */

/**
 * Calls `start` with the moment the entrance begins (performance.now()) the first time `element`
 * scrolls into view, as every entrance waits (entrance.ts). Returns its stop.
 */
export function onEntrance(element: Element, start: (at: number) => void) {
  let first = true
  const observer = new IntersectionObserver(
    (entries) => {
      const initial = first
      first = false
      if (!entries.some(inView)) return
      observer.disconnect()
      start(washStartTime(initial))
    },
    { threshold: washThreshold, rootMargin: washRootMargin },
  )
  observer.observe(element)
  return () => observer.disconnect()
}

/** A grid's columns for the wash: its tracks, or --wash-columns for a grid whose cells span several (the logo tiles, index.css). */
export function washColumns(element: Element) {
  const style = getComputedStyle(element)
  return Math.max(
    1,
    Number(style.getPropertyValue("--wash-columns")) || style.gridTemplateColumns.split(" ").filter(Boolean).length,
  )
}

export { inView, washRootMargin, washStartTime, washThreshold }

// The time each item was last asked to come in at, so a late picture never lands a stale request.
const washes = new WeakMap<HTMLElement, number | undefined>()

/**
 * Brings one item of a wash (its `data-slot="brand"`) in at `at`, a performance.now() time, or, with
 * an `image`, as soon as that has loaded and decoded after then, so no empty box animates in; a
 * picture that fails never comes in, so it stays hidden while its grid is armed. The load comes
 * first: Safari rejects decode() on an image that hasn't loaded, such as a lazy one off screen.
 * `at` undefined takes the item out again (a replay). The app's avatar wall and the static pages'
 * walls (src/client/islands/home.ts) both run it.
 */
export function washItem(brand: HTMLElement, at: number | undefined, image?: HTMLImageElement | null) {
  washes.set(brand, at)
  if (at === undefined) {
    delete brand.dataset.state
    brand.style.removeProperty("--logo-delay")
    brand.style.removeProperty("--wipe-delay")
    return
  }
  const show = () => {
    if (washes.get(brand) !== at) return
    const delay = `${Math.round(Math.max(0, at - performance.now()))}ms`
    brand.style.setProperty("--logo-delay", delay)
    brand.style.setProperty("--wipe-delay", delay)
    brand.dataset.state = "in"
  }
  if (!image) return show()
  const decode = () => void image.decode().then(show, () => {})
  if (image.complete && image.naturalWidth > 0) return decode()
  image.addEventListener("load", decode, { once: true })
}

/**
 * An item's place in a diagonal wash from the top left: diagonal by diagonal (row + column), and
 * row by row within one, so one item starts per step across every row.
 */
export function washStep(index: number, columns: number, count: number) {
  const rows = Math.max(1, Math.ceil(count / columns))
  const row = Math.floor(index / columns)
  return rows * (row + (index % columns)) + row
}

// Settings › Logo animation, as the custom properties reveal.css reads.
export function revealMotion(animation: (typeof logoAnimations)[number], tuning: SiteSettings["logoTuning"]) {
  const timing = tuning[animation]
  const base = {
    "--logo-duration": `${timing.duration}ms`,
    "--logo-out": `${Math.round(timing.duration * 0.6)}ms`,
    "--logo-delay": `${timing.delay}ms`,
    ...("easing" in timing
      ? { "--logo-easing": easings[timing.easing][0], "--logo-easing-out": easings[timing.easing][1] }
      : {}),
  }
  if (animation === "blur") return { ...base, "--logo-blur": `${tuning.blur.blur}px` }
  if (animation === "rise")
    return { ...base, "--logo-rise": `${tuning.rise.rise}px`, "--logo-blur": `${tuning.rise.blur}px` }
  if (animation === "scale") return { ...base, "--logo-scale": tuning.scale.scale / 100 }
  if (animation === "flip")
    return {
      ...base,
      "--flip-perspective": `${tuning.flip.perspective}px`,
      "--flip-in": tuning.flip.axis === "x" ? "rotateX(-90deg)" : "rotateY(90deg)",
      "--flip-out": tuning.flip.axis === "x" ? "rotateX(90deg)" : "rotateY(-90deg)",
    }
  if (animation === "pixel") return { ...base, ...levels(scattered, tuning.pixel.block, tuning.pixel.steps) }
  if (animation === "dither")
    return {
      ...base,
      ...levels(tuning.dither.pattern === "bayer 2×2" ? bayer2 : bayer4, tuning.dither.dot, tuning.dither.steps),
    }
  if (animation === "scanline")
    return {
      ...base,
      "--logo-steps": tuning.scanline.steps,
      "--scan-spacing": `${tuning.scanline.spacing}px`,
      "--scan-hidden": tuning.scanline.direction === "down" ? "inset(0 0 100% 0)" : "inset(100% 0 0 0)",
      "--scan-gone": tuning.scanline.direction === "down" ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)",
    }
  if (animation === "type")
    return {
      ...base,
      "--logo-steps": tuning.type.steps,
      "--type-hidden": tuning.type.direction === "left to right" ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)",
    }
  if (animation === "wipe") {
    const forward = tuning.wipe.direction === "left to right"
    return {
      ...base,
      "--wipe-in-from": forward ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)",
      "--wipe-out-to": forward ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)",
      "--wipe-line-from": forward ? "0%" : `calc(100% - ${tuning.wipe.thickness}px)`,
      "--wipe-line-to": forward ? `calc(100% - ${tuning.wipe.thickness}px)` : "0%",
      "--wipe-thickness": `${tuning.wipe.thickness}px`,
      "--wipe-line": tuning.wipe.line === "on" ? "block" : "none",
    }
  }
  if (animation === "glitch") return { ...base, ...slices(tuning.glitch.slices, tuning.glitch.offset) }
  return base
}

// In and out curves for each easing choice.
const easings = {
  "ease-out": ["var(--ease-out)", "cubic-bezier(0.5, 0, 0.75, 0)"],
  "ease-in-out": ["cubic-bezier(0.65, 0, 0.35, 1)", "cubic-bezier(0.65, 0, 0.35, 1)"],
  linear: ["linear", "linear"],
  snap: ["cubic-bezier(0.16, 1, 0.3, 1)", "cubic-bezier(0.7, 0, 0.84, 0)"],
} as const

// Fill orders for the cells of a square tile: ordered (Bayer) dithers and a scattered 4×4.
const bayer2 = [
  [0, 2],
  [3, 1],
]
const bayer4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]
const scattered = [
  [9, 2, 14, 5],
  [0, 12, 7, 11],
  [15, 4, 1, 8],
  [6, 10, 13, 3],
]

// The 15 intermediate masks the levels keyframes step through. `steps` distinct levels are spread
// across them, each filling the cells whose order is below its share of the tile.
function levels(matrix: number[][], cell: number, steps: number) {
  const size = matrix.length
  const tile = size * cell
  return Object.fromEntries([
    ["--tile", `${tile}px`],
    ...Array.from({ length: 15 }, (_, index) => {
      const filled = Math.round((Math.floor(((index + 1) * steps) / 16) / steps) * size * size)
      const path = matrix
        .flatMap((row, y) =>
          row.map((order, x) => (order < filled ? `M${x * cell} ${y * cell}h${cell}v${cell}h-${cell}z` : "")),
        )
        .join("")
      return [
        `--level-${index + 1}`,
        `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}' shape-rendering='crispEdges'%3E%3Cpath d='${path}'/%3E%3C/svg%3E")`,
      ]
    }),
  ])
}

// Six glitch frames: the first `count` are horizontal slices shifted sideways by up to `offset`
// pixels, getting smaller; the rest are settled.
function slices(count: number, offset: number) {
  return Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => {
      const on = index < count
      const top = (index * 37) % 60
      const bottom = Math.max(0, 100 - top - 20 - ((index * 23) % 40))
      return [
        [`--glitch-${index + 1}`, on ? `inset(${top}% 0 ${bottom}% 0)` : "inset(0)"],
        [
          `--shift-${index + 1}`,
          on ? `${(index % 2 ? 1 : -1) * Math.max(1, Math.round(offset * (1 - index / count)))}px` : "0px",
        ],
      ]
    }).flat(),
  )
}
