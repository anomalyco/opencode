export * as Currency from "./currency"

// Approximate display exchange rates, units per 1 USD. Snapshot: 2026-08.
// These are display-only approximations and are never billing-authoritative.
export const ExchangeRates: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 0.86,
  GBP: 0.74,
  JPY: 147.5,
  CNY: 7.15,
  HKD: 7.8,
  SGD: 1.34,
  KRW: 1380,
  INR: 84,
  CAD: 1.37,
  AUD: 1.52,
  NZD: 1.68,
  CHF: 0.8,
  SEK: 10.5,
  NOK: 10.8,
  DKK: 6.9,
  PLN: 3.9,
  BRL: 5.4,
  MXN: 18.5,
  ZAR: 18,
}

export function normalize(currency: string): string {
  return currency.trim().toUpperCase()
}

export function rate(currency: string, overrides?: Readonly<Record<string, number>>): number | undefined {
  const code = normalize(currency)
  if (overrides) {
    const matches = Object.entries(overrides).filter(([key]) => normalize(key) === code)
    if (matches.length > 0) {
      for (const [, value] of matches) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
      }
      return undefined
    }
  }
  const builtin = ExchangeRates[code]
  if (typeof builtin === "number" && builtin > 0) return builtin
  return undefined
}

export function convert(
  amount: number,
  from: string,
  to: string,
  rates?: Readonly<Record<string, number>>,
): number | undefined {
  const source = normalize(from)
  const target = normalize(to)
  if (source === target) return amount
  const fromRate = rate(source, rates)
  const toRate = rate(target, rates)
  if (!fromRate || !toRate) return undefined
  return (amount / fromRate) * toRate
}

const formatters = new Map<string, Intl.NumberFormat>()

export function format(amount: number, currency: string, locale = "en-US"): string {
  const code = normalize(currency)
  const key = `${locale}\u0000${code}`
  let formatter = formatters.get(key)
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, { style: "currency", currency: code })
    } catch {
      return `${amount.toFixed(2)} ${code}`
    }
    formatters.set(key, formatter)
  }
  return formatter.format(amount)
}
