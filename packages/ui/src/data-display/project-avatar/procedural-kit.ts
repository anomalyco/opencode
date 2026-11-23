// Shared pieces of the experimental project icon styles in procedural.ts: the style definition, the pixel grid that
// most styles paint, and color, random and dithering helpers. Only the components lab imports these modules.

import { PALETTES, valueNoise } from "./generated"

export type Params = Readonly<Record<string, number>>

export type Random = () => number

export type Definition = {
  id: string
  name: string
  label: string
  family: string
  animated?: boolean
  resolve: (random: (tag: string) => Random) => Record<string, number>
} & (
  | { paint: (pixels: Pixels, p: Params, t: number) => void }
  | { vector: (ctx: CanvasRenderingContext2D, px: number, p: Params, t: number) => void }
)

export class Pixels {
  readonly cells: Int32Array

  constructor(readonly n: number) {
    this.cells = new Int32Array(n * n)
  }

  set(x: number, y: number, color: number) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return
    this.cells[y * this.n + x] = color
  }

  get(x: number, y: number) {
    return this.cells[Math.min(this.n - 1, Math.max(0, y)) * this.n + Math.min(this.n - 1, Math.max(0, x))]
  }

  fill(color: number) {
    this.cells.fill(color)
  }

  rect(x: number, y: number, width: number, height: number, color: number) {
    for (let row = y; row < y + height; row++)
      for (let column = x; column < x + width; column++) this.set(column, row, color)
  }

  /** Cells whose centres fall within `r` of (`cx`, `cy`), in grid units. */
  disc(cx: number, cy: number, r: number, color: number) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.set(x, y, color)
  }

  /** A one-cell Bresenham line, ends included. */
  line(x0: number, y0: number, x1: number, y1: number, color: number) {
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let x = x0
    let y = y0
    let error = dx + dy

    for (;;) {
      this.set(x, y, color)

      if (x === x1 && y === y1) return
      const double = 2 * error

      if (double >= dy) {
        error += dy
        x += sx
      }

      if (double <= dx) {
        error += dx
        y += sy
      }
    }
  }

  /** Paints every cell that `color` returns a color for. */
  each(color: (x: number, y: number) => number | undefined) {
    for (let y = 0; y < this.n; y++)
      for (let x = 0; x < this.n; x++) {
        const value = color(x, y)

        if (value !== undefined) this.cells[y * this.n + x] = value
      }
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export function stars(pixels: Pixels, rand: Random, sky: number, count: number) {
  Array.from({ length: count }, () =>
    pixels.set(Math.floor(rand() * pixels.n), Math.floor(rand() * pixels.n), mix(sky, 0xffffff, 0.3 + rand() * 0.5)),
  )
}

/** James's paper-and-ink palettes: `c0` is the paper, `c1`–`c4` the inks. */
export function palette(random: Random) {
  return prefixed(
    "c",
    PALETTES[Math.floor(random() * PALETTES.length)].map((color) => parseInt(color.slice(1), 16)),
  )
}

export function prefixed(prefix: string, values: readonly number[]) {
  return Object.fromEntries(values.map((value, i) => [`${prefix}${i}`, value]))
}

export function colors(p: Params, prefix = "c", count = 5) {
  return Array.from({ length: count }, (_, i) => p[`${prefix}${i}`])
}

export function ramped(list: number[]) {
  return list.toSorted((a, b) => luma(a) - luma(b))
}

// A color from `list` that stands out against `against`, or the one that stands out most.
export function legible(random: Random, list: number[], against: number) {
  const contrast = (color: number) => Math.abs(luma(color) - luma(against))
  const clear = list.filter((color) => contrast(color) > 0.4)

  return clear.length ? pick(random, clear) : list.toSorted((a, b) => contrast(b) - contrast(a))[0]
}

export function pick<T>(random: Random, list: readonly T[]) {
  return list[Math.floor(random() * list.length)]
}

/** A number in [`low`, `high`). */
export function range(random: Random, low: number, high: number) {
  return low + random() * (high - low)
}

/** A whole number from `low` to `high`, both included. */
export function int(random: Random, low: number, high: number) {
  return low + Math.floor(random() * (high - low + 1))
}

export function shuffle<T>(random: Random, list: readonly T[]) {
  return list
    .map((value) => ({ value, order: random() }))
    .toSorted((a, b) => a.order - b.order)
    .map((entry) => entry.value)
}

export function retry<T>(make: () => T, ok: (value: T) => boolean): T {
  const value = make()

  return ok(value) ? value : retry(make, ok)
}

export function seed(random: Random) {
  return Math.floor(random() * 4294967296)
}

export function ones(bits: number) {
  return bits.toString(2).replaceAll("0", "").length
}

export function threshold(x: number, y: number) {
  return (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16
}

// Ordered dithering: which of `levels` steps a value in [0, 1] takes at this cell.
export function dither(value: number, levels: number, x: number, y: number) {
  return Math.min(levels - 1, Math.floor(clamp01(value) * (levels - 1) + threshold(x, y)))
}

/** A stable value in [0, 1) for one cell, for grain and scatter. */
export function grain(x: number, y: number, salt: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453

  return value - Math.floor(value)
}

/** Two octaves of value noise, roughly in [0, 1]. */
export function fbm(x: number, y: number) {
  return 0.65 * valueNoise(x, y) + 0.35 * valueNoise(x * 2.1 + 5.2, y * 2.1 + 1.3)
}

export function mix(a: number, b: number, t: number) {
  const k = clamp01(t)
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k)

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

export function shade(color: number, amount: number) {
  return mix(0x000000, color, amount)
}

export function tint(color: number, amount: number) {
  return mix(color, 0xffffff, amount)
}

/** Multiplies two colors channel by channel, like ink printed over ink. */
export function multiply(a: number, b: number) {
  const channel = (shift: number) => Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255)

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** A color from hue (turns), saturation and lightness in [0, 1]. */
export function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255)

  return (channel(0) << 16) | (channel(8) << 8) | channel(4)
}

export function luma(color: number) {
  return (0.2126 * ((color >> 16) & 255) + 0.7152 * ((color >> 8) & 255) + 0.0722 * (color & 255)) / 255
}

export function css(color: number, alpha = 1) {
  if (alpha < 1) return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`

  return `#${color.toString(16).padStart(6, "0")}`
}

export function ease(value: number) {
  const k = clamp01(value)

  return k * k * (3 - 2 * k)
}

export function smoothstep(edge0: number, edge1: number, value: number) {
  return ease((value - edge0) / (edge1 - edge0))
}

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function normalize(x: number, y: number, z: number) {
  const length = Math.hypot(x, y, z)

  return [x / length, y / length, z / length]
}
