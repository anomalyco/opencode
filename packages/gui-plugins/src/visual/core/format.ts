/** Formats a number with a fixed size and no trailing zeros. */
export function fmt(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "0"
  const rounded = Math.abs(value) >= 1000 ? Math.round(value) : Number(value.toFixed(decimals))

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(rounded)
}

/** Formats a value with its unit, separated by a thin space. */
export function withUnit(value: number, unit?: string, decimals = 2): string {
  return unit ? `${fmt(value, decimals)} ${unit}` : fmt(value, decimals)
}

/** Engineering notation for large or small magnitudes: 12.4 kN, 0.82 MPa, 3.1 µm. */
export function engineering(value: number, unit: string, decimals = 2): string {
  const magnitude = Math.abs(value)

  const prefixes: Array<[number, string]> = [
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
  ]

  for (const [size, prefix] of prefixes) {
    if (magnitude >= size || size === 1e-9) return `${fmt(value / size, decimals)} ${prefix}${unit}`
  }

  return `${fmt(value, decimals)} ${unit}`
}

/** Trims a label to one line, so long model text cannot break a drawing. */
export function short(text: string, max = 56): string {
  const clean = text.replace(/\s+/g, " ").trim()

  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** A compact signed value for deltas: +0.12, -0.04. */
export function signed(value: number, decimals = 2): string {
  const text = fmt(Math.abs(value), decimals)

  return value < 0 ? `−${text}` : `+${text}`
}

/** Percent from a ratio, clamped for bars but not for labels. */
export function percent(value: number, total: number, decimals = 0): string {
  if (total === 0) return "0%"

  return `${fmt((value / total) * 100, decimals)}%`
}
