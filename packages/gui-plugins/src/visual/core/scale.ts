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

/** A resolved axis: the domain the scale maps and whether it uses a log scale. */
export type AxisDomain = {
  readonly domain: [number, number]
  readonly log: boolean
}

/**
 * A domain from declared bounds or the values. A log axis keeps only positive values and falls back to a linear
 * domain when the declared bounds are not positive or no positive value remains.
 */
export function axisDomain(
  values: readonly number[],
  options: { readonly declared?: readonly [number, number]; readonly log?: boolean } = {},
): AxisDomain {
  const finite = values.filter((value) => Number.isFinite(value))
  const declared = options.declared
  const logSafe = finite.every((value) => value > 0)

  if (declared && Number.isFinite(declared[0]) && Number.isFinite(declared[1])) {
    const low = Math.min(declared[0], declared[1])
    const high = Math.max(declared[0], declared[1])

    return { domain: [low, high], log: options.log === true && logSafe && low > 0 && high > 0 }
  }

  const positive = finite.filter((value) => value > 0)

  if (options.log === true && logSafe && positive.length > 0) {
    return { domain: [Math.min(...positive) / 1.15, Math.max(...positive) * 1.15], log: true }
  }

  return { domain: [Math.min(...finite, 0), Math.max(...finite, 1)], log: false }
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

function round2(value: number) {
  return Math.round(value * 100) / 100
}
