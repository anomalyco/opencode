// Apply an `LLMRequest.cache` policy by injecting `CacheHint`s onto the parts
// the policy designates. Runs once at compile time, before the per-protocol
// body builder, so the existing inline-hint lowering path handles the rest.
//
// The default `"auto"` shape places breakpoints at the last tool definition,
// the first and last distinct system parts, and the conversation tail. This
// exposes reusable tool, base-agent, project, and session prefixes while
// advancing the tail after each tool result keeps recent conversation prefixes
// reusable during long agent runs.
//
// Manual `cache: CacheHint` placements on individual parts are preserved and
// count against the four-breakpoint budget; auto only fills remaining slots.
import type { Capabilities } from "./capabilities.js"
import { CacheHint, type CachePolicy, type CachePolicyObject, type CacheTTL } from "./schema/options.js"
import {
  AssistantMessage,
  type LLMRequest,
  type Message,
  SystemMessage,
  ToolDefinition,
  ToolMessage,
  UserMessage,
  type ContentPart,
  type ToolEntry,
} from "./schema/messages.js"
import { effortUpdate } from "./effort-updates.js"
import { toolsUpdate } from "./tool-updates.js"

const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: { tail: 1 },
}

const NONE: CachePolicyObject = {}
const BREAKPOINT_CAP = 4

// Resolution rules:
//   - undefined   → "auto" — caching is on by default.
//   - "auto"      → tools + first/last system + final message boundary.
//   - "none"      → no auto placement; manual `CacheHint`s still flow.
//   - `{ ttl }`   → "auto" with that lifetime.
//   - object form → exactly what the caller asked for.
const resolve = (policy: CachePolicy | undefined): CachePolicyObject => {
  if (policy === "none") return NONE
  if (typeof policy === "object" && !isAuto(policy)) return policy
  return AUTO
}

const isAuto = (policy: CachePolicy | undefined) =>
  policy === undefined ||
  policy === "auto" ||
  (typeof policy === "object" &&
    policy.tools === undefined &&
    policy.system === undefined &&
    policy.messages === undefined)

/** The requested cache lifetime, for routes that send it as a request-level option instead of on markers. */
export const requestTTL = (request: LLMRequest) => (typeof request.cache === "object" ? request.cache.ttl : undefined)

// Qwen ignores breakpoints on tool definitions and caches tools with the system prompt.
const QWEN: CachePolicyObject = { system: true, messages: { tail: 1 } }

/**
 * `models` patterns for gateways that forward cache markers, steering only where `cache: "auto"` puts them; an
 * explicit layout is sent for every model. Upstreams other than Anthropic and Alibaba Qwen cache without breakpoints;
 * Gemini uses only the last breakpoint, so a conversation-tail breakpoint would write a new cache every step.
 * `~…` IDs are OpenRouter aliases for the latest model in a family.
 */
export const gatewayModels = {
  "*": { cache: { markers: true, auto: "none" } },
  "anthropic/*": { cache: { auto: "standard" } },
  "~anthropic/*": { cache: { auto: "standard" } },
  "qwen/*": { cache: { auto: "qwen" } },
  "~qwen/*": { cache: { auto: "qwen" } },
  "alibaba/qwen*": { cache: { auto: "qwen" } },
  "~alibaba/qwen*": { cache: { auto: "qwen" } },
} as const satisfies Record<string, Capabilities.Any>

const makeHint = (ttl: CacheTTL | undefined): CacheHint =>
  ttl !== undefined ? new CacheHint({ type: "ephemeral", ttl }) : new CacheHint({ type: "ephemeral" })

interface Budget {
  remaining: number
}

const markLastTool = (tools: ReadonlyArray<ToolEntry>, hint: CacheHint, budget: Budget): ReadonlyArray<ToolEntry> => {
  const target = tools.at(-1)
  if (target === undefined) return tools
  if (target.type === "namespace") {
    const nested = markLastTool(target.tools, hint, budget)
    return nested === target.tools ? tools : [...tools.slice(0, -1), { ...target, tools: nested }]
  }
  if (target.cache || budget.remaining === 0) return tools
  budget.remaining -= 1
  return [...tools.slice(0, -1), new ToolDefinition({ ...target, cache: hint })]
}

const countToolHints = (tools: ReadonlyArray<ToolEntry>): number =>
  tools.reduce(
    (count, tool) => count + (tool.type === "tool" ? (tool.cache === undefined ? 0 : 1) : countToolHints(tool.tools)),
    0,
  )

const markSystemBoundaries = (system: LLMRequest["system"], hint: CacheHint, budget: Budget): LLMRequest["system"] => {
  if (system.length === 0) return system
  let changed = false
  const next = system.map((part, index) => {
    if ((index !== 0 && index !== system.length - 1) || part.cache || budget.remaining === 0) return part
    budget.remaining -= 1
    changed = true
    return { ...part, cache: hint }
  })
  return changed ? next : system
}

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message["role"]): number =>
  messages.findLastIndex((m) => m.role === role)

type CacheablePart = Exclude<ContentPart, { readonly type: "compaction" | "effort" }>

const isCacheablePart = (part: ContentPart): part is CacheablePart =>
  part.type !== "compaction" && part.type !== "effort"

// Mark the last text part of `messages[index]`. If no text part exists, mark
// the last cacheable content part — that's the breakpoint position
// in tool-result-only messages too.
const markMessageAt = (
  messages: ReadonlyArray<Message>,
  index: number,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages
  const target = messages[index]!
  if (target.content.length === 0) return messages
  const lastTextIndex = target.content.findLastIndex((part) => part.type === "text")
  const markAt = lastTextIndex >= 0 ? lastTextIndex : target.content.findLastIndex(isCacheablePart)
  const existing = target.content[markAt]
  if (!existing || !isCacheablePart(existing) || existing.cache || budget.remaining === 0) return messages
  budget.remaining -= 1
  const next = cachePartAt(target, markAt, hint)
  // Single pass over `messages`, substituting the one updated entry. Long
  // conversations call this on every request, so avoid `.map()` here — its
  // closure dispatch and identity copies show up in profiling.
  const result = messages.slice()
  result[index] = next
  return result
}

const cachePartAt = (message: Message, index: number, hint: CacheHint): Message => {
  switch (message.role) {
    case "system":
      return new SystemMessage({ ...message, content: cacheContentAt(message.content, index, hint) })
    case "user":
      return new UserMessage({ ...message, content: cacheContentAt(message.content, index, hint) })
    case "assistant":
      return new AssistantMessage({ ...message, content: cacheContentAt(message.content, index, hint) })
    case "tool":
      return new ToolMessage({ ...message, content: cacheContentAt(message.content, index, hint) })
  }
}

const cacheContentAt = <Part extends ContentPart>(content: ReadonlyArray<Part>, index: number, hint: CacheHint) =>
  content.map((part, i) => (i === index ? { ...part, cache: hint } : part))

const markMessages = (
  messages: ReadonlyArray<Message>,
  strategy: NonNullable<CachePolicyObject["messages"]>,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  if (messages.length === 0) return messages
  if (strategy === "latest-user-message")
    return markMessageAt(messages, lastIndexOfRole(messages, "user"), hint, budget)
  if (strategy === "latest-assistant")
    return markMessageAt(messages, lastIndexOfRole(messages, "assistant"), hint, budget)
  let start = messages.length
  let remaining = strategy.tail
  while (remaining > 0 && start > 0) {
    start -= 1
    if (!isMarker(messages[start]!)) remaining -= 1
  }
  let next = messages
  for (let i = start; i < messages.length; i++) if (!isMarker(messages[i]!)) next = markMessageAt(next, i, hint, budget)
  return next
}

const isMarker = (message: Message) => effortUpdate(message) !== undefined || toolsUpdate(message) !== undefined

const countHints = (request: LLMRequest) =>
  countToolHints(request.tools) +
  request.system.reduce((count, part) => count + (part.cache === undefined ? 0 : 1), 0) +
  request.messages.reduce(
    (count, message) =>
      count +
      message.content.reduce(
        (contentCount, part) => contentCount + (isCacheablePart(part) && part.cache !== undefined ? 1 : 0),
        0,
      ),
    0,
  )

export const applyCachePolicy = (request: LLMRequest): LLMRequest => {
  const policy = selectPolicy(request)
  if (!policy.tools && !policy.system && !policy.messages) return request

  const hint = makeHint(requestTTL(request))
  const budget = { remaining: Math.max(0, BREAKPOINT_CAP - countHints(request)) }
  const tools = policy.tools ? markLastTool(request.tools, hint, budget) : request.tools
  const system = policy.system ? markSystemBoundaries(request.system, hint, budget) : request.system
  const messages = policy.messages ? markMessages(request.messages, policy.messages, hint, budget) : request.messages

  if (tools === request.tools && system === request.system && messages === request.messages) return request
  return { ...request, tools, system, messages }
}

/** Whether the cache policy places inline markers, which then carry the requested lifetime. */
export const placesMarkers = (request: LLMRequest) => {
  const policy = selectPolicy(request)
  return Boolean(policy.tools || policy.system || policy.messages)
}

// A declared cache format overrides whether the endpoint reads markers.
const selectPolicy = (request: LLMRequest): CachePolicyObject => {
  const cache = request.model.capabilities?.cache
  if (cache === false || cache === undefined) return NONE
  const auto = isAuto(request.cache)
  if (cache.format === "alibaba") return auto ? QWEN : { ...resolve(request.cache), tools: false }
  if (cache.format === "anthropic") return resolve(request.cache)
  if (!cache.markers) return NONE
  if (!auto) return resolve(request.cache)
  if (cache.auto === "qwen") return QWEN
  if (cache.auto === "none") return NONE
  return AUTO
}
