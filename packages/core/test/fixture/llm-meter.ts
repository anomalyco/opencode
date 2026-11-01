import { LLMEvent, type LLMRequest, type Message, type ToolEntry } from "@opencode/ai"

/**
 * A provider that meters the way a real one does, so harness behaviour can be measured instead
 * of asserted: it counts the tokens of the request it is handed and reports a cache read only
 * for a prefix an earlier request already wrote.
 *
 * Providers bill a cache hit far below an uncached input token, so what a step costs depends on
 * how much of its prompt was reusable. A fake that always reports `cacheRead: inputTokens` makes
 * any cache policy look perfect. This one reports only the prefix it can prove, which is the
 * number worth optimising, and it reaches that number from the same `CacheHint` markers the
 * policy places on the request.
 */

/** Rough token count. Providers disagree by tens of percent; the ratios here are what matter. */
const CHARS_PER_TOKEN = 4

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

/** The text a provider actually bills for a request, in wire order. */
export const requestText = (request: Pick<LLMRequest, "system" | "tools" | "messages">): string =>
  [
    request.system.map(systemBytes).join("\n"),
    request.tools.map(toolBytes).join("\n"),
    request.messages.map((message) => messageBytes(message.role, message.content)).join("\n"),
  ].join("\n")

/**
 * The prefix each `CacheHint` marks, from the start of the request up to and including that
 * part. A provider caches exactly this, so two requests share a cache read when one of these
 * prefixes is a prefix of the other's text.
 */
export const breakpointPrefixes = (request: Pick<LLMRequest, "system" | "tools" | "messages">): string[] => {
  const prefixes: string[] = []
  let text = ""

  for (const part of request.system) {
    text += `${systemBytes(part)}\n`
    if (part.cache) prefixes.push(text)
  }

  for (const tool of request.tools) {
    text += `${toolBytes(tool)}\n`
    if ("cache" in tool && tool.cache) prefixes.push(text)
  }

  for (const message of request.messages) {
    for (const part of message.content) {
      text += `${messageBytes(message.role, [part])}\n`
      if ("cache" in part && part.cache) prefixes.push(text)
    }
  }

  return prefixes
}

export interface Meter {
  /** Requests the run produced, in order. */
  readonly seen: () => readonly LLMRequest[]
  /** Input tokens billed at full price. */
  readonly uncached: () => number
  /** Input tokens served from cache. */
  readonly cached: () => number
  /** Output tokens billed. */
  readonly output: () => number
  /** Cached share of input. Higher means a cache policy is reusing more of each prompt. */
  readonly cacheHitRate: () => number
  /** Cost in a cache-priced currency: uncached input 1, cache read 0.1, output 5. */
  readonly relativeCost: () => number
}

export const meter = () => {
  const written: string[] = []
  const seen: LLMRequest[] = []
  const totals = { uncached: 0, cached: 0, output: 0 }

  // The longest prefix this run already wrote, so a growing conversation keeps its prefix and
  // only the new tail is billed.
  const longestKnownPrefix = (text: string) => {
    let longest = ""
    for (const prefix of written) if (prefix.length > longest.length && text.startsWith(prefix)) longest = prefix
    return longest
  }

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

        const text = requestText(request)
        const total = estimate(text)
        const reusable = longestKnownPrefix(text)
        const cached = reusable ? Math.min(total, estimate(reusable)) : 0
        const uncached = Math.max(0, total - cached)

        for (const prefix of breakpointPrefixes(request)) if (!written.includes(prefix)) written.push(prefix)

        totals.uncached += uncached
        totals.cached += cached

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
              inputTokens: total,
              nonCachedInputTokens: uncached,
              cacheReadInputTokens: cached,
              cacheWriteInputTokens: 0,
              outputTokens: output,
              reasoningTokens: 0,
            },
          }),
          LLMEvent.finish({ reason: { normalized: reason.normalized === "tool-calls" ? "tool-calls" : "stop" } }),
        ]
      },

    uncached: () => totals.uncached,
    cached: () => totals.cached,
    output: () => totals.output,
    cacheHitRate: () => {
      const input = totals.uncached + totals.cached
      return input === 0 ? 0 : totals.cached / input
    },
    relativeCost: () => totals.uncached + totals.cached * 0.1 + totals.output * 5,
  }
}

export type { Message, ToolEntry }
