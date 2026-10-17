import { LLMEvent, type LLMRequest, type Message, type ToolEntry } from "@opencode/ai"

/**
 * A provider that meters the way a real one does, so harness behaviour can be measured instead
 * of asserted: it counts the tokens of the request it is handed and reports a cache read only
 * for a prefix an earlier request already wrote.
 *
 * Providers bill a cache hit below an uncached input token and a cache write above it, so what a
 * step costs depends on how much of its prompt was reusable and how much of it had to be written.
 * A fake that always reports `cacheRead: inputTokens` makes any cache policy look perfect; one
 * that reports writes as free makes marking more prefixes look free too. This one prices both,
 * and it finds the reusable prefix in the same `CacheHint` markers the policy places.
 */

/** Rough token count. Providers disagree by tens of percent; the ratios here are what matter. */
const CHARS_PER_TOKEN = 4

/** Anthropic's multipliers against an uncached input token, for the default five-minute cache. */
const READ_COST = 0.1
const WRITE_COST = 1.25
const OUTPUT_COST = 5

const estimate = (value: string) => Math.max(0, Math.round(value.length / CHARS_PER_TOKEN))

/**
 * A part's bytes without its cache marker. A provider caches the content it is sent, not the
 * marker that placed it, so two requests share a prefix only when their bytes agree. Serialising
 * the marker in would make every recorded prefix fail to match the next request, and the whole run
 * would look like it reused almost nothing.
 */
const contentOf = (part: unknown) => {
  if (part === null || typeof part !== "object") return JSON.stringify(part)
  const { cache: _cache, ...rest } = part as Record<string, unknown>
  return JSON.stringify(rest)
}

const systemBytes = (part: { text: string }) => `system ${part.text}`
const toolBytes = (tool: unknown) => `tool ${contentOf(tool)}`
const messageBytes = (role: string, parts: readonly unknown[]) => `message ${role} ${parts.map(contentOf).join("")}`

/** The blocks a provider bills for a request, in wire order, joined by one separator. */
const blocks = (request: Pick<LLMRequest, "system" | "tools" | "messages">) => [
  ...request.system.map(systemBytes),
  ...request.tools.map(toolBytes),
  ...request.messages.map((message) => messageBytes(message.role, message.content)),
]

/** The text a provider actually bills for a request, in wire order. */
export const requestText = (request: Pick<LLMRequest, "system" | "tools" | "messages">): string =>
  blocks(request).join("\n")

/**
 * The prefix each `CacheHint` marks, from the start of the request up to and including that
 * part. A provider caches exactly this, so two requests share a cache read when one of these
 * prefixes is a prefix of the other's text. Built the same way as `requestText`, so a marker on
 * the final part yields the whole request rather than the whole request plus a separator.
 */
export const breakpointPrefixes = (request: Pick<LLMRequest, "system" | "tools" | "messages">): string[] => {
  const prefixes: string[] = []
  let text = ""
  const separator = () => {
    if (text.length > 0) text += "\n"
  }

  for (const part of request.system) {
    separator()
    text += systemBytes(part)
    if (part.cache) prefixes.push(text)
  }

  for (const tool of request.tools) {
    separator()
    text += toolBytes(tool)
    if ("cache" in tool && tool.cache) prefixes.push(text)
  }

  for (const message of request.messages) {
    separator()
    text += `message ${message.role} `
    for (const part of message.content) {
      text += contentOf(part)
      if ("cache" in part && part.cache) prefixes.push(text)
    }
  }

  return prefixes
}

export interface Tally {
  /** Tokens the request contained. */
  readonly input: number
  /** Tokens billed at the full input price, after the last breakpoint. */
  readonly uncached: number
  /** Tokens written to the cache, between the reused prefix and the last breakpoint. */
  readonly written: number
  /** Tokens read from a prefix an earlier request wrote. */
  readonly cached: number
}

export interface Charge extends Tally {
  readonly request: LLMRequest
  /** Input cost in uncached-token units: a read costs 0.1 and a write 1.25. */
  readonly inputCost: number
}

export interface Bill {
  readonly steps: readonly Charge[]
  readonly input: number
  readonly uncached: number
  readonly written: number
  readonly cached: number
  /** Cached share of input. Higher means a cache policy is reusing more of each prompt. */
  readonly cacheHitRate: number
  /** Input cost with a read at 0.1 and a write at 1.25 of an uncached token. */
  readonly inputCost: number
}

/**
 * What one request costs a provider that caches prefixes, given the prefixes already written by
 * earlier requests in the same run. No breakpoint means the provider has nowhere to look the
 * prefix up, so identical text is still billed in full; otherwise the reusable prefix is read,
 * the gap up to the furthest breakpoint is written, and the rest is billed at full price.
 */
const charge = (request: LLMRequest, written: string[]): Tally => {
  const text = requestText(request)
  const input = estimate(text)
  const marks = breakpointPrefixes(request)
  if (marks.length === 0) return { input, uncached: input, written: 0, cached: 0 }

  const reused = written.reduce(
    (longest, prefix) => (prefix.length > longest.length && text.startsWith(prefix) ? prefix : longest),
    "",
  )
  // Prefixes carry the separator after the marked part, so clamp to the request itself.
  const reusedTokens = Math.min(input, estimate(reused))
  const furthest = Math.min(input, estimate(marks.at(-1)!))

  for (const mark of marks) if (!written.includes(mark)) written.push(mark)

  return {
    input,
    uncached: input - Math.max(reusedTokens, furthest),
    written: Math.max(0, furthest - reusedTokens),
    cached: Math.min(reusedTokens, furthest),
  }
}

const costOf = (tally: Tally) => tally.uncached + tally.cached * READ_COST + tally.written * WRITE_COST

const sum = (steps: readonly Charge[], key: keyof Tally) => steps.reduce((total, step) => total + step[key], 0)

/** Prices a sequence of requests the way a caching provider would bill them. */
export const bill = (requests: readonly LLMRequest[]): Bill => {
  const written: string[] = []
  const steps = requests.map((request) => {
    const tally = charge(request, written)
    return { request, ...tally, inputCost: costOf(tally) }
  })
  const input = sum(steps, "input")
  const cached = sum(steps, "cached")

  return {
    steps,
    input,
    uncached: sum(steps, "uncached"),
    written: sum(steps, "written"),
    cached,
    cacheHitRate: input === 0 ? 0 : cached / input,
    inputCost: steps.reduce((total, step) => total + step.inputCost, 0),
  }
}

export interface Meter {
  /** Requests the run produced, in order. */
  readonly seen: () => readonly LLMRequest[]
  /** Input tokens the requests contained. */
  readonly input: () => number
  /** Input tokens billed at full price. */
  readonly uncached: () => number
  /** Input tokens written to the cache. */
  readonly written: () => number
  /** Input tokens served from cache. */
  readonly cached: () => number
  /** Output tokens billed. */
  readonly output: () => number
  /** Cached share of input. Higher means a cache policy is reusing more of each prompt. */
  readonly cacheHitRate: () => number
  /** Input cost with a read at 0.1 and a write at 1.25 of an uncached token. */
  readonly inputCost: () => number
  /** Input cost plus output at five times an uncached input token. */
  readonly relativeCost: () => number
}

export const meter = () => {
  const written: string[] = []
  const seen: LLMRequest[] = []
  const totals = { input: 0, uncached: 0, written: 0, cached: 0, output: 0 }

  return {
    seen: () => seen,

    /**
     * Wraps a responder that decides what the model does. The metered layer decides what the
     * provider charges, which is the part a harness actually controls.
     */
    respond:
      (decide: (request: LLMRequest) => readonly LLMEvent[]) =>
      (request: LLMRequest): readonly LLMEvent[] => {
        seen.push(request)

        const tally = charge(request, written)
        totals.input += tally.input
        totals.uncached += tally.uncached
        totals.written += tally.written
        totals.cached += tally.cached

        const events = decide(request)
        const output = events.find((event) => event.type === "step-finish")?.usage?.outputTokens ?? 64
        const reason = events.find((event) => event.type === "finish")?.reason ?? { normalized: "stop" as const }

        totals.output += output

        return [
          ...events.filter((event) => event.type !== "step-finish" && event.type !== "finish"),
          LLMEvent.stepFinish({
            index: 0,
            reason: { normalized: reason.normalized === "tool-calls" ? "tool-calls" : "stop" },
            usage: {
              inputTokens: tally.input,
              nonCachedInputTokens: tally.uncached,
              cacheReadInputTokens: tally.cached,
              cacheWriteInputTokens: tally.written,
              outputTokens: output,
              reasoningTokens: 0,
            },
          }),
          LLMEvent.finish({ reason: { normalized: reason.normalized === "tool-calls" ? "tool-calls" : "stop" } }),
        ]
      },

    input: () => totals.input,
    uncached: () => totals.uncached,
    written: () => totals.written,
    cached: () => totals.cached,
    output: () => totals.output,
    cacheHitRate: () => (totals.input === 0 ? 0 : totals.cached / totals.input),
    inputCost: () => costOf(totals),
    relativeCost: () => costOf(totals) + totals.output * OUTPUT_COST,
  }
}

export type { Message, ToolEntry }
