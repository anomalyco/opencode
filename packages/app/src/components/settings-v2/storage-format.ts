const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const

export function formatBytes(bytes: number, locale: string) {
  const safe = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  const exponent = safe === 0 ? 0 : Math.min(Math.floor(Math.log(safe) / Math.log(1024)), units.length - 1)
  const value = safe / 1024 ** exponent
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value)} ${units[exponent]}`
}

export function formatCount(count: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(count)
}
