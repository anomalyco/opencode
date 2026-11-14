/** Formats a number with a fixed size and no trailing zeros. */
export function fmt(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "0"
  const rounded = Math.abs(value) >= 1000 ? Math.round(value) : Number(value.toFixed(decimals))

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(rounded)
}

/** Trims a label to one line, so long model text cannot break a drawing. */
export function short(text: string, max = 56): string {
  const clean = text.replace(/\s+/g, " ").trim()

  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
