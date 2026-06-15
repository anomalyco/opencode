export namespace CostDisplay {
  export type Config = {
    currency?: string
    cost_currency?: string
    currency_rate?: number
  }

  const USD_RATE: Record<string, number> = {
    USD: 1,
    CNY: 7.2,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 155,
    KRW: 1_370,
  }

  export function format(locale: string, cost: number, config?: Config) {
    const from = currency(config?.cost_currency)
    const next = currency(config?.currency)
    return money(locale, cost * rate(config, from, next), next) ?? money(locale, cost, "USD") ?? `$${cost.toFixed(2)}`
  }

  function currency(input: string | undefined) {
    const value = input?.trim().toUpperCase()
    if (!value) return "USD"
    if (/^[A-Z]{3}$/.test(value)) return value
    return "USD"
  }

  function rate(config: Config | undefined, from: string, next: string) {
    if (from === next) return 1
    if (config?.currency_rate && Number.isFinite(config.currency_rate) && config.currency_rate > 0)
      return config.currency_rate
    return (USD_RATE[next] ?? 1) / (USD_RATE[from] ?? 1)
  }

  function money(locale: string, value: number, next: string) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: next,
        currencyDisplay: "symbol",
      }).format(value)
    } catch {
      return
    }
  }
}
