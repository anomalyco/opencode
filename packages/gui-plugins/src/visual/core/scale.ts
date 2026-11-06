import { clamp } from "./json"

export interface Scale {
  readonly domain: readonly [number, number]
  readonly range: readonly [number, number]
  (value: number): number
  readonly invert: (pixel: number) => number
}

/** A linear scale that tolerates a zero-width domain. */
export function linear(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0

  return Object.assign(
    (value: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)),
    {
      domain,
      range,
      invert: (pixel: number) => (span === 0 ? d0 : d0 + ((pixel - r0) / (r1 - r0 || 1)) * span),
    },
  )
}

/** Extends a domain to include every value, with a little air. */
export function extent(values: readonly number[], fallback: readonly [number, number] = [0, 1]): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value))

  if (finite.length === 0) return [fallback[0], fallback[1]]
  let min = Math.min(...finite)
  let max = Math.max(...finite)

  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    min -= pad
    max += pad
  }

  return [min, max]
}

/** A domain that includes zero, for bars and areas. */
export function includeZero(domain: readonly [number, number]): [number, number] {
  return [Math.min(0, domain[0]), Math.max(0, domain[1])]
}

/** Rounded tick values at 1, 2 or 5 times a power of ten. */
export function ticks(domain: readonly [number, number], count = 5): number[] {
  const [min, max] = domain
  const span = max - min

  if (span <= 0 || !Number.isFinite(span)) return [min]
  const rough = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  const step = (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * power
  const first = Math.ceil(min / step - 1e-9) * step
  const values: number[] = []

  for (let value = first; value <= max + step * 1e-9 && values.length < 24; value += step) {
    values.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)))
  }

  return values
}

/** A tick label that carries only the digits the step needs. */
export function tickLabel(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)))

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(value)
}

/** SVG path through points, or an empty string. */
export function linePath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return ""

  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${round2(x)},${round2(y)}`).join(" ")
}

/** SVG path closed to a baseline, for area fills. */
export function areaPath(points: ReadonlyArray<readonly [number, number]>, baseline: number): string {
  if (points.length === 0) return ""
  const first = points[0]
  const last = points[points.length - 1]

  return `${linePath(points)} L${round2(last[0])},${round2(baseline)} L${round2(first[0])},${round2(baseline)} Z`
}

/** A smooth cubic path through points (Catmull-Rom converted to Béziers). */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length < 2) return linePath(points)
  let path = `M${round2(points[0][0])},${round2(points[0][1])}`

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[Math.min(points.length - 1, index + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    path += ` C${round2(c1x)},${round2(c1y)} ${round2(c2x)},${round2(c2y)} ${round2(p2[0])},${round2(p2[1])}`
  }

  return path
}

/** Maps a value into a 0–1 progress, clamped. */
export function progress(value: number, min: number, max: number): number {
  if (max === min) return 0

  return clamp((value - min) / (max - min), 0, 1)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
