import type { Usage } from "./events.js"
import type { CacheTTL, OpenString } from "./options.js"

/** A models.dev v2 cost condition: exactly one operator. Strings compare lexicographically. */
export type CostCondition =
  | { readonly equals: string | number | boolean }
  | { readonly in: ReadonlyArray<string | number | boolean> }
  | { readonly gt: number | string }
  | { readonly gte: number | string }
  | { readonly lt: number | string }
  | { readonly lte: number | string }
  | { readonly minItems: number }

/** When a cost override or multiplier applies, from models.dev v2 `when` in camelCase. */
export interface CostWhen {
  readonly context?: CostCondition
  readonly duration?: CostCondition
  readonly megapixels?: CostCondition
  readonly inputImages?: CostCondition
  readonly serviceTier?: CostCondition
  readonly region?: CostCondition
  readonly date?: CostCondition
  readonly utcDays?: CostCondition
  readonly utcHours?: CostCondition
  readonly holiday?: CostCondition
  readonly thinking?: CostCondition
  readonly resolution?: CostCondition
  readonly quality?: CostCondition
  readonly aspectRatio?: CostCondition
  readonly generateAudio?: CostCondition
  readonly mode?: CostCondition
  readonly inputVideo?: CostCondition
  readonly fps?: CostCondition
  readonly steps?: CostCondition
  readonly searchContextSize?: CostCondition
  readonly speakerLabels?: CostCondition
  readonly keytermsPrompt?: CostCondition
  readonly domain?: CostCondition
  readonly websocket?: CostCondition
  readonly style?: CostCondition
  readonly voiceControl?: CostCondition
  readonly all?: ReadonlyArray<CostWhen>
  readonly any?: ReadonlyArray<CostWhen>
  readonly not?: CostWhen
}

/** USD per 1M tokens or characters, else per unit. A cache write price may be keyed by TTL. */
export interface CachePrices {
  readonly read?: number
  readonly write?: number | { readonly [ttl: CacheTTL]: number }
  readonly storage?: number
}

export interface CacheCost extends CachePrices {
  readonly explicit?: CachePrices
}

export type CostUnit = OpenString<"token" | "character" | "image" | "megapixel" | "second" | "minute">

export interface InputCost {
  readonly unit?: CostUnit
  readonly price: number
  readonly cache?: CacheCost
  readonly overrides?: ReadonlyArray<{ readonly when: CostWhen; readonly price?: number; readonly cache?: CacheCost }>
}

export interface OutputCost {
  readonly unit?: CostUnit
  readonly price: number
  readonly reasoning?: number
  readonly overrides?: ReadonlyArray<{ readonly when: CostWhen; readonly price?: number; readonly reasoning?: number }>
}

export interface ModalityCost {
  readonly input?: InputCost
  readonly output?: OutputCost
}

/** A number multiplies every price; an object multiplies only the prices it names. */
export type CostFactor = number | { readonly [key: string]: CostFactor }

/** Model pricing, from models.dev v2 `cost` in camelCase. */
export interface Cost {
  readonly text?: ModalityCost
  readonly image?: ModalityCost
  readonly audio?: ModalityCost
  readonly video?: ModalityCost
  /** USD per 1,000 web searches. */
  readonly webSearch?: {
    readonly price: number
    readonly overrides?: ReadonlyArray<{ readonly when: CostWhen; readonly price?: number }>
  }
  readonly multipliers?: ReadonlyArray<{ readonly when: CostWhen; readonly factor: CostFactor }>
}

/**
 * USD for `usage` at a model's listed prices. Prices per-token text: input, output (reasoning tokens at the output
 * price), cache reads and cache writes (the first TTL listed), with `context` overrides as tiers that apply above
 * their size. Other units, conditions and multipliers are not priced. A `usage.cost` the endpoint reported is more
 * accurate than this when present.
 */
export const calculateCost = (cost: Cost | undefined, usage: Usage) => {
  const input = safe(usage.nonCachedInputTokens)
  const output = safe(usage.visibleOutputTokens)
  const reasoning = safe(usage.reasoningTokens)
  const read = safe(usage.cacheReadInputTokens)
  const write = safe(usage.cacheWriteInputTokens)
  const prices = pricesAt(cost, input + read + write)
  if (!prices) return 0
  return (
    (input * finite(prices.input) +
      (output + reasoning) * finite(prices.output) +
      read * finite(prices.read) +
      write * finite(prices.write)) /
    1_000_000
  )
}

interface Prices {
  readonly input: number
  readonly output: number
  readonly read: number
  readonly write: number
}

const finite = (value: number) => (Number.isFinite(value) ? value : 0)
const safe = (value: number | undefined) => Math.max(0, finite(value ?? 0))
const perToken = (unit: CostUnit | undefined) => unit === undefined || unit === "token"

// The text prices for a request whose context is `context` tokens: the largest tier it exceeds, else the base.
function pricesAt(cost: Cost | undefined, context: number): Prices | undefined {
  const text = cost?.text
  if (!text?.input || !text.output || !perToken(text.input.unit) || !perToken(text.output.unit)) return undefined
  const base: Prices = {
    input: text.input.price,
    output: text.output.price,
    read: text.input.cache?.read ?? 0,
    write: cacheWrite(text.input.cache) ?? 0,
  }
  // An override merges field by field, so a tier keeps every base price it doesn't set.
  const tiers = new Map<number, Prices>()
  const tier = (when: CostWhen) => {
    const size = Object.keys(when).length === 1 ? contextSize(when.context) : undefined
    if (size === undefined) return undefined
    const entry = tiers.get(size) ?? base
    tiers.set(size, entry)
    return [size, entry] as const
  }
  for (const override of text.input.overrides ?? []) {
    const found = tier(override.when)
    if (!found) continue
    tiers.set(found[0], {
      ...found[1],
      input: override.price ?? found[1].input,
      read: override.cache?.read ?? found[1].read,
      write: cacheWrite(override.cache) ?? found[1].write,
    })
  }
  for (const override of text.output.overrides ?? []) {
    const found = tier(override.when)
    if (found) tiers.set(found[0], { ...found[1], output: override.price ?? found[1].output })
  }
  const size = Math.max(...[...tiers.keys()].filter((size) => context > size))
  return tiers.get(size) ?? base
}

// A context tier is a `context` condition with a numeric `gt` or `gte`; either way it applies above that size.
function contextSize(condition: CostCondition | undefined) {
  if (typeof condition !== "object" || condition === null) return undefined
  const gt = "gt" in condition ? condition.gt : undefined
  const gte = "gte" in condition ? condition.gte : undefined
  if ((gt !== undefined && !isFiniteNumber(gt)) || (gte !== undefined && !isFiniteNumber(gte))) return undefined
  return gt ?? gte
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

// One cache write price: the first TTL listed, else the explicit cache's.
function cacheWrite(cache: CacheCost | undefined) {
  const first = (write: CachePrices["write"]) => (typeof write === "object" ? Object.values(write)[0] : write)
  return first(cache?.write) ?? first(cache?.explicit?.write)
}
