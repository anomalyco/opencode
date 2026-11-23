// Soft Radar, the activity spinner: a 5×5 dot grid whose lit head sweeps clockwise around each square ring, leaving a
// fading trail, with the centre dot steady. All frames are baked once into a vertical SVG mask strip so each spinner is
// one composited transform animation instead of 25 separate SVG elements.

const span = 5

/** Dot side and pitch, in a 16-unit viewBox. */
const size = 2

const pitch = 3

/** Seconds per loop at 1×. */
export const radarLoop = 1.8

/** Discrete frames baked into the vertical sprite strip (20 fps at 1×). */
export const radarFrames = 36

/** Frame shown for reduced motion: the sweep frozen about a fifth of the way into its loop. */
export const radarStillFrame = Math.round(0.22 * radarFrames)

/** Resting opacity of an unlit dot. */
const dim = 0.2

// The trail's ease-in-out fade over 48% of the loop, sampled every 4%, from a level below the head's.
const fade = [1, 0.987, 0.934, 0.812, 0.599, 0.384, 0.238, 0.143, 0.081, 0.041, 0.017, 0.004, 0]

/** The trail a dot leaves once the head has passed: [percent of the loop, level from 0 (dim) to 1 (lit)]. */
const trail = [...fade.map((level, index) => [index * 4, round(0.55 * level)] as const), [100, 0] as const]

export type RadarDot = {
  x: number
  y: number
  size: number
  /** Where in the loop the dot lights, 0–1. */
  at: number
  /** The centre dot stays lit and never animates. */
  steady: boolean
  /** Opacity for reduced motion: the sweep frozen a fifth of the way into its loop. */
  still: number
  /** Which of the opacity curves the dot runs. */
  curve: number
}

type Cell = { gx: number; gy: number }

const cached = layout()

/** The radar's dots, positioned in a 16-unit viewBox. */
export function radarDots() {
  return cached.dots
}

/** One dot's opacity (0.2–1) at loop phase 0–1. */
export function radarOpacity(dot: RadarDot, phase: number) {
  const level = dot.steady ? trail[0]![1] : levelAt(cached.curves[dot.curve]!, frac(phase - dot.at) * 100)

  return round(dim + (1 - dim) * level)
}

/** One vertical SVG sprite strip containing every frame of the radar loop. */
export function radarSpriteSvg() {
  const rx = round(size * 0.24)

  const frames = Array.from({ length: radarFrames }, (_, frame) => {
    const phase = frame / radarFrames
    const offset = frame * 16

    return cached.dots
      .map((dot) => {
        const opacity = radarOpacity(dot, phase)
        const fillOpacity = opacity === dim ? "" : ` fill-opacity='${opacity}'`

        return `<rect x='${dot.x}' y='${dot.y + offset}' width='${dot.size}' height='${dot.size}' rx='${rx}'${fillOpacity}/>`
      })
      .join("")
  }).join("")

  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 ${radarFrames * 16}' fill='black' fill-opacity='${dim}'>${frames}</svg>`
}

/** Shared stylesheet driving every Soft Radar spinner from one cached SVG mask and one transform animation. */
export function radarStylesheet(name: string) {
  const encoded = radarSpriteSvg().replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E")
  const stillOffset = round((radarStillFrame / radarFrames) * 100)

  return [
    `@keyframes ${name}{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,-100%,0)}}`,
    `:where([data-slot="spinner-dots"] > [data-slot="spinner-strip"]){`,
    `height:${radarFrames * 100}%;`,
    `--spinner-still:translate3d(0,-${stillOffset}%,0);`,
    `--spinner-mask:url("data:image/svg+xml,${encoded}");`,
    `-webkit-mask-image:var(--spinner-mask);`,
    `mask-image:var(--spinner-mask);`,
    `animation:${name} calc(${radarLoop}s * var(--spinner-time, 1)) steps(${radarFrames},end) infinite;`,
    `}`,
  ].join("")
}

function layout() {
  const placed = Array.from({ length: span * span }, (_, index) => {
    const cell = { gx: (index % span) - (span - 1) / 2, gy: Math.floor(index / span) - (span - 1) / 2 }

    return { cell, at: angle(cell), steady: cell.gx === 0 && cell.gy === 0 }
  })

  // Each dot's shape depends on how far it sits from its neighbours on its square ring, in loop fractions.
  const ringOf = (cell: Cell) => Math.max(Math.abs(cell.gx), Math.abs(cell.gy))

  const keys = placed.map((dot) => {
    if (dot.steady) return ""
    const others = placed.filter((other) => other !== dot && !other.steady && ringOf(other.cell) === ringOf(dot.cell))
    const behind = Math.min(...others.map((other) => frac(dot.at - other.at)))
    const ahead = Math.min(...others.map((other) => frac(other.at - dot.at)))

    return `${round(behind)} ${round(ahead)}`
  })

  const unique = [...new Set(keys.filter((key) => key !== ""))]

  const curves = unique.map((key) => {
    const [behind, ahead] = key.split(" ").map(Number)

    return headStops(behind! * 100, ahead! * 100)
  })

  const dots = placed.map((dot, index): RadarDot => {
    const curve = Math.max(0, unique.indexOf(keys[index]!))
    // The steady centre glows like the fresh trail, so the head stays the brightest dot.
    const level = dot.steady ? trail[0]![1] : levelAt(curves[curve]!, frac(0.22 - dot.at) * 100)

    return {
      x: round(8 + dot.cell.gx * pitch - size / 2),
      y: round(8 + dot.cell.gy * pitch - size / 2),
      size,
      at: round(dot.at),
      steady: dot.steady,
      still: round(dim + (1 - dim) * level),
      curve,
    }
  })

  return { dots, curves }
}

// One dot's level through the loop, 0% being the moment the head passes it, with `behind` and `ahead` the percent of
// the loop to its neighbours on its ring. It's lit while it's the dot nearest the head, then the trail takes over.
function headStops(behind: number, ahead: number): (readonly [number, number])[] {
  const edge = 1.5
  const off = ahead / 2 + edge
  const on = 100 - behind / 2

  return [
    [0, 1],
    [ahead / 2, 1],
    [off, levelAt(trail, off)],
    ...trail.filter(([percent]) => percent > off && percent < 100 && percent < on - edge),
    [on - edge, 0],
    [on, 1],
    [100, 1],
  ]
}

// Clockwise from 12 o'clock, 0–1.
function angle(cell: Cell) {
  return frac(Math.atan2(cell.gx, -cell.gy) / (2 * Math.PI))
}

function levelAt(stops: readonly (readonly [number, number])[], percent: number) {
  const next = stops.findIndex(([at]) => at >= percent)

  if (next <= 0) return stops[0]?.[1] ?? 0
  const [p0, l0] = stops[next - 1]!
  const [p1, l1] = stops[next]!

  return l0 + ((l1 - l0) * (percent - p0)) / (p1 - p0 || 1)
}

function frac(value: number) {
  return value - Math.floor(value)
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
