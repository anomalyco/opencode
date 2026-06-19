import { Schema } from "effect"

/**
 * Provider account balance — the "credits left" surfaced next to the spend
 * meter for pay-as-you-go cloud providers.
 *
 * Provider-agnostic by design: the shape below is generic, and each provider
 * that can report a balance registers a {@link BalanceProbe} in
 * {@link BALANCE_PROBES} keyed by its providerID. Providers without a probe
 * simply have no balance (the endpoint returns `undefined`). Adding a new
 * provider is a one-line registry entry — no changes to the route or the TUI.
 */
export const ProviderBalance = Schema.Struct({
  /** Spend still available, in `currency`, if known. */
  remaining: Schema.optional(Schema.Number),
  /** Total credits / spend limit, if the provider exposes one. */
  limit: Schema.optional(Schema.Number),
  /** Amount already used, if known. */
  used: Schema.optional(Schema.Number),
  /** ISO 4217 currency code; defaults conceptually to USD. */
  currency: Schema.optional(Schema.String),
}).annotate({ identifier: "ProviderBalance" })
export type ProviderBalance = Schema.Schema.Type<typeof ProviderBalance>

/**
 * Resolves a provider's balance from its API key. Returns `null` when the
 * provider can't report one (no key, unsupported, transient failure). Must not
 * throw — callers treat a thrown error as "no balance".
 */
export type BalanceProbe = (input: { apiKey: string }) => Promise<ProviderBalance | null>

const openrouter: BalanceProbe = async ({ apiKey }) => {
  // https://openrouter.ai/docs/api-reference/get-credits
  const res = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } }
  const data = body.data
  if (!data) return null
  const limit = typeof data.total_credits === "number" ? data.total_credits : undefined
  const used = typeof data.total_usage === "number" ? data.total_usage : undefined
  const remaining = limit != null && used != null ? limit - used : undefined
  return { remaining, limit, used, currency: "USD" }
}

/**
 * Registry of per-provider balance probes, keyed by providerID. The extension
 * seam: register a provider here to give it a "credits left" readout.
 */
export const BALANCE_PROBES: Record<string, BalanceProbe> = {
  openrouter,
}
