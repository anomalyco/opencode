export * as CacheProbe from "./cache-probe.js"

import type { ContentPart, LLMRequest, Message, ToolEntry } from "@opencode/ai/effect"
import type { TokenUsage } from "@opencode/schema/token-usage"
import { Hash } from "@opencode/util/hash"

/** Anthropic's default prompt-cache lifetime; OpenAI keeps prefixes about as long. */
export const CACHE_TTL_MS = 5 * 60 * 1000
/** OpenAI caches in 1,024-token blocks, so smaller drops are bucket jitter. */
export const MISS_FLOOR = 1024
const MAX_SESSIONS = 256
const MAX_TOOL_NAMES = 5

export type Request = Pick<
  LLMRequest,
  "system" | "messages" | "tools" | "toolChoice" | "providerOptions" | "promptCacheKey"
>

interface MessagePrint {
  readonly key: string | undefined
  readonly role: string
  readonly hash: string
  readonly media: number
  readonly checkpoint: boolean
}

/** Hashes of each request segment, in the order providers build their cached prefix. */
export interface Fingerprint {
  readonly at: number
  readonly model: string
  readonly options: Readonly<Record<string, string>>
  readonly tools: ReadonlyArray<readonly [name: string, hash: string]>
  readonly system: ReadonlyArray<string>
  readonly messages: ReadonlyArray<MessagePrint>
}

export type Reason =
  | "model-switch"
  | "options-changed"
  | "tools-changed"
  | "instructions-changed"
  | "compaction"
  | "history-rewritten"
  | "idle-ttl"
  | "provider-eviction"

export interface Change {
  readonly reason: Reason
  readonly detail?: string
}

export interface Miss extends Change {
  readonly missed: number
  readonly idle?: string
}

const INLINE_DATA_MIN = 1024

// Inline media is summarized by type and size so hashing stays fast; replacing or cutting it still changes the hash.
const replacer = (key: string, value: unknown) => {
  if (key === "source" && value && typeof value === "object" && "data" in value) {
    const source = value as { type: string; mediaType?: string; data: string | Uint8Array }
    const size = typeof source.data === "string" ? source.data.length : source.data.byteLength
    return { type: source.type, mediaType: source.mediaType, size }
  }
  if (key === "uri" && typeof value === "string" && value.startsWith("data:") && value.length > INLINE_DATA_MIN)
    return `${value.slice(0, value.indexOf(",") + 1)}${value.length}`
  return value
}
const hash = (value: unknown) => Hash.fast(JSON.stringify(value, replacer) ?? "")

const mediaCount = (part: ContentPart) => {
  if (part.type === "media") return 1
  if (part.type !== "tool-result" || part.result.type !== "content") return 0
  return part.result.value.filter((item) => item.type === "file").length
}

// Tool results carry no message id, but their call id is unique within the session.
const messageKey = (message: Message) => message.id ?? message.content.find((part) => part.type === "tool-result")?.id

const isCheckpoint = (message: Message) =>
  message.content.some(
    (part) => part.type === "compaction" || (part.type === "text" && part.text.startsWith("<conversation-checkpoint>")),
  )

// Message and part cache hints only steer breakpoints and their metadata never reaches the provider, so neither affects
// the cached prefix. Same-named keys inside schemas, tool inputs and results do, so only these levels are stripped.
const prefixOf = (message: Message) => ({
  ...message,
  cache: undefined,
  metadata: undefined,
  content: message.content.map((part) => ({ ...part, cache: undefined, metadata: undefined })),
})

const printMessage = (message: Message): MessagePrint => ({
  key: messageKey(message),
  role: message.role,
  hash: hash(prefixOf(message)),
  media: message.content.reduce((total, part) => total + mediaCount(part), 0),
  checkpoint: isCheckpoint(message),
})

const toolPrint = (tool: ToolEntry): readonly [string, string] =>
  tool.type === "namespace"
    ? [tool.name, hash([tool.description, tool.tools])]
    : [tool.name, hash([tool.description, tool.inputSchema, tool.outputSchema, tool.native])]

export const fingerprint = (input: {
  readonly request: Request
  readonly model: string
  readonly at: number
}): Fingerprint => {
  const request = input.request
  return {
    at: input.at,
    model: input.model,
    // Sampling and output limits (`generation`) don't key the cache; maxTokens changes every step.
    options: {
      toolChoice: hash(request.toolChoice),
      providerOptions: hash(request.providerOptions),
      promptCacheKey: request.promptCacheKey ?? "",
    },
    tools: request.tools.map(toolPrint),
    system: request.system.map((part) => Hash.fast(part.text)),
    messages: request.messages.map(printMessage),
  }
}

/** Tokens the previous prompt made cacheable that this step did not read back. */
export const missed = (previous: TokenUsage.Info, current: TokenUsage.Info) =>
  previous.input + previous.cache.read + previous.cache.write - current.cache.read

const names = (list: ReadonlyArray<string>) =>
  list.length > MAX_TOOL_NAMES
    ? [...list.slice(0, MAX_TOOL_NAMES), `…+${list.length - MAX_TOOL_NAMES}`].join(" ")
    : list.join(" ")

const toolChange = (previous: Fingerprint, current: Fingerprint): Change | undefined => {
  if (
    previous.tools.length === current.tools.length &&
    previous.tools.every(
      ([name, hash], index) => current.tools[index]![0] === name && current.tools[index]![1] === hash,
    )
  )
    return
  const before = new Map(previous.tools)
  const after = new Map(current.tools)
  const added = current.tools.filter(([name]) => !before.has(name)).map(([name]) => `+${name}`)
  const removed = previous.tools.filter(([name]) => !after.has(name)).map(([name]) => `-${name}`)
  const changed = current.tools
    .filter(([name, hash]) => before.has(name) && before.get(name) !== hash)
    .map(([name]) => `~${name}`)
  const detail = [...added, ...removed, ...changed]
  return { reason: "tools-changed", detail: detail.length > 0 ? names(detail) : "reordered" }
}

const messageChange = (previous: Fingerprint, current: Fingerprint): Change | undefined => {
  const index = previous.messages.findIndex((message, index) => current.messages[index]?.hash !== message.hash)
  if (index === -1) return
  const before = previous.messages[index]!
  const after = current.messages[index]
  if (after?.checkpoint)
    return {
      reason: "compaction",
      detail: `messages ${previous.messages.length}→${current.messages.length}`,
    }
  const why =
    after === undefined
      ? "truncated"
      : before.media > after.media
        ? "media-removed"
        : before.key !== after.key
          ? "replaced"
          : "edited"
  return { reason: "history-rewritten", detail: `messages[${index}] ${before.role} ${why}` }
}

/** The first prefix segment that differs between two consecutive requests, in provider cache order. */
export const firstChange = (previous: Fingerprint, current: Fingerprint): Change | undefined => {
  if (previous.model !== current.model) return { reason: "model-switch", detail: `${previous.model}→${current.model}` }
  const options = Object.keys(current.options).filter((key) => previous.options[key] !== current.options[key])
  if (options.length > 0) return { reason: "options-changed", detail: options.join(",") }
  const tools = toolChange(previous, current)
  if (tools) return tools
  const system = Math.max(previous.system.length, current.system.length)
  for (let index = 0; index < system; index++)
    if (previous.system[index] !== current.system[index])
      return { reason: "instructions-changed", detail: `system[${index}]` }
  return messageChange(previous, current)
}

const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`
}

export interface Step {
  readonly print: Fingerprint
  readonly usage: TokenUsage.Info
}

/** Names why `current` missed the cache `previous` left behind, or undefined when it did not miss. */
export const diagnose = (previous: Step, current: Step): Miss | undefined => {
  const lost = missed(previous.usage, current.usage)
  if (lost <= MISS_FLOOR) return
  const gap = current.print.at - previous.print.at
  const idle = gap > CACHE_TTL_MS ? duration(gap) : undefined
  const change = firstChange(previous.print, current.print)
  return {
    missed: lost,
    ...(change ?? { reason: idle ? "idle-ttl" : "provider-eviction" }),
    ...(idle ? { idle } : {}),
  }
}

interface Entry extends Step {
  /** Whether the provider reported cache activity by this step. Implicit caches (OpenAI, Gemini) report no writes,
   * so a step is only expected to read back once an earlier one showed the provider caches at all. */
  readonly cached: boolean
}

/** Last settled request per session, bounded to the most recently active sessions. */
export class Tracker {
  readonly #entries = new Map<string, Entry>()

  observe(input: Parameters<typeof fingerprint>[0]): Fingerprint | undefined {
    try {
      return fingerprint(input)
    } catch {
      return undefined
    }
  }

  settle(sessionID: string, print: Fingerprint, usage: TokenUsage.Info): Miss | undefined {
    const previous = this.#entries.get(sessionID)
    const cached = (previous?.cached ?? false) || usage.cache.read > 0 || usage.cache.write > 0
    this.#entries.delete(sessionID)
    this.#entries.set(sessionID, { print, usage, cached })
    if (this.#entries.size > MAX_SESSIONS) this.#entries.delete(this.#entries.keys().next().value!)
    if (!previous?.cached) return
    try {
      return diagnose(previous, { print, usage })
    } catch {
      return undefined
    }
  }

  delete(sessionID: string) {
    this.#entries.delete(sessionID)
  }

  get size() {
    return this.#entries.size
  }
}
