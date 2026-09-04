import type { Config } from "@opencode-ai/sdk/v2"
import { Currency } from "@opencode-ai/core/currency"

export function formatCost(amount: number, source: string, display: Config["display"]): string {
  const target = display?.currency?.trim()
  if (!target) return Currency.format(amount, source)
  const converted = Currency.convert(amount, source, target, display?.exchangeRates)
  if (converted === undefined) return Currency.format(amount, source)
  return Currency.format(converted, target)
}

export function sourceCurrency(model: { cost?: { currency?: string } } | undefined): string {
  return model?.cost?.currency ?? "USD"
}
