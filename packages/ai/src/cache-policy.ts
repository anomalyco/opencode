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
// Anthropic reads an earlier cache entry only within 20 block positions of a
// breakpoint. When the newest reply and message add 20+ blocks (a batch of
// attached files, say), the tail breakpoint can't reach the previous request's
// entry and the whole conversation is written again. On Anthropic's own API,
// auto therefore also marks the message before the newest assistant reply,
// where the previous request put its tail breakpoint, so that entry is read
// directly. The first system part, which only adds the base prompt to the tools
// prefix, keeps its breakpoint only when one is left over, as on a Session's
// first request.
//
// Manual `cache: CacheHint` placements on individual parts are preserved and
// count against the four-breakpoint budget; auto only fills remaining slots,
// in the order tools, last system part, conversation tail, previous tail, first
// system part. Every auto hint takes the requested lifetime. Anthropic rejects a
// longer lifetime after a shorter one, so the protocols that send lifetimes put
// them in order once the body is built (`orderLifetimes`), when the send order
// of every marker is known.
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

const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: { tail: 1 },
}

const NONE: CachePolicyObject = {}
const BREAKPOINT_CAP = 4

// `previousTail` is internal: it marks the message before the newest assistant reply.
type Placement = CachePolicyObject & { readonly previousTail?: boolean }

// Resolution rules:
//   - undefined   → "auto" — caching is on by default.
//   - "auto"      → tools + first/last system + final message boundary; on
//                   Anthropic's API also the previous request's tail, which
//                   takes the first system part's slot when the budget runs out.
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

// Protocols whose wire format ignores inline cache markers (OpenAI's implicit
// prefix caching, Gemini's implicit + out-of-band CachedContent). Skip the
// whole policy pass for these — emitting hints would be harmless but pointless.
const RESPECTS_INLINE_HINTS = new Set([
  "alibaba-chat",
  "alibaba-messages",
  "anthropic-messages",
  "anthropic-compatible-messages",
  "bedrock-mantle-messages",
  "cloudflare-ai-gateway-messages",
  "google-vertex-messages",
  "meta-messages",
  "minimax-messages",
  "moonshot-messages",
  "vercel-ai-gateway-messages",
  "zai-coding-messages",
  "bedrock-converse",
  "openrouter",
  "digitalocean",
])

// OpenRouter and Vercel AI Gateway upstreams other than Anthropic and Alibaba Qwen cache without breakpoints.
// Gemini uses only the last breakpoint, so a conversation-tail breakpoint writes a new cache every step and costs
// more than none. Qwen ignores breakpoints on tool definitions and caches tools with the system prompt.
const QWEN: CachePolicyObject = { system: true, messages: { tail: 1 } }
const gatewayPolicy = (modelID: string): CachePolicyObject => {
  // `~anthropic/claude-sonnet-latest` style IDs are OpenRouter aliases for the latest model in a family.
  const id = modelID.replace(/^~/, "")
  if (id.startsWith("anthropic/")) return AUTO
  if (id.startsWith("qwen/") || id.startsWith("alibaba/qwen")) return QWEN
  return NONE
}

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

const markSystemPart = (
  system: LLMRequest["system"],
  index: number,
  hint: CacheHint,
  budget: Budget,
): LLMRequest["system"] => {
  const part = system[index]
  if (!part || part.cache || budget.remaining === 0) return system
  budget.remaining -= 1
  return system.map((item, i) => (i === index ? { ...item, cache: hint } : item))
}

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message["role"]): number =>
  messages.findLastIndex((m) => m.role === role)

type CacheablePart = Exclude<ContentPart, { readonly type: "compaction" | "effort" }>

const isCacheablePart = (part: ContentPart): part is CacheablePart =>
  part.type !== "compaction" && part.type !== "effort"

// Protocols send a marker only on blocks that can carry one: tool calls and reasoning never do, provider-executed
// results are replayed as-is, and blank text is dropped. A hint on any of them would spend a slot and send nothing.
const isMarkable = (part: ContentPart): part is CacheablePart => {
  if (part.type === "text") return part.text.trim().length > 0
  if (part.type === "tool-result") return part.providerExecuted !== true
  return part.type === "media"
}

// Mark the last text part of `messages[index]`. If no text part exists, mark
// the last markable content part — that's the breakpoint position in
// tool-result-only messages too. A message with nothing markable keeps its slot.
const markMessageAt = (
  messages: ReadonlyArray<Message>,
  index: number,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages
  const target = messages[index]!
  const lastTextIndex = target.content.findLastIndex((part) => part.type === "text" && isMarkable(part))
  const markAt = lastTextIndex >= 0 ? lastTextIndex : target.content.findLastIndex(isMarkable)
  const existing = target.content[markAt]
  if (!existing || !isMarkable(existing) || existing.cache || budget.remaining === 0) return messages
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
    if (effortUpdate(messages[start]!) === undefined) remaining -= 1
  }
  // Newest first: when the budget runs short, the conversation tail must keep its breakpoint.
  let next = messages
  for (let i = messages.length - 1; i >= start; i--)
    if (effortUpdate(messages[i]!) === undefined) next = markMessageAt(next, i, hint, budget)
  return next
}

// The previous request ended at the message before the newest assistant reply and wrote its tail entry there.
// Marking that message again reads the entry directly, however many blocks the reply and the newest message add.
const markPreviousTail = (messages: ReadonlyArray<Message>, hint: CacheHint, budget: Budget) => {
  const reply = lastIndexOfRole(messages, "assistant")
  const index = messages.findLastIndex((message, i) => i < reply && effortUpdate(message) === undefined)
  return markMessageAt(messages, index, hint, budget)
}

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
  // The last system part comes first; the first one only adds the base prompt to the tools prefix, so it takes a
  // breakpoint only when the conversation has left one over.
  const lastSystem = policy.system
    ? markSystemPart(request.system, request.system.length - 1, hint, budget)
    : request.system
  const tail = policy.messages ? markMessages(request.messages, policy.messages, hint, budget) : request.messages
  const messages = policy.previousTail ? markPreviousTail(tail, hint, budget) : tail
  const system = policy.system ? markSystemPart(lastSystem, 0, hint, budget) : lastSystem

  if (tools === request.tools && system === request.system && messages === request.messages) return request
  return { ...request, tools, system, messages }
}

/** Whether the cache policy places inline markers, which then carry the requested lifetime. */
export const placesMarkers = (request: LLMRequest) => {
  const policy = selectPolicy(request)
  return Boolean(policy.tools || policy.system || policy.messages)
}

// A declared cache format overrides the route allowlist and its model-ID heuristics.
const selectPolicy = (request: LLMRequest): Placement => {
  const format = request.model.compatibility?.cacheFormat
  const route = request.model.route.id
  const auto = isAuto(request.cache)
  if (format === "alibaba") return auto ? QWEN : { ...resolve(request.cache), tools: false }
  if (format === "anthropic") return resolve(request.cache)
  if (!RESPECTS_INLINE_HINTS.has(route)) return NONE
  if (!auto) return resolve(request.cache)
  if (route === "openrouter" || route === "vercel-ai-gateway-messages") return gatewayPolicy(request.model.id)
  if (route === "alibaba-chat") return request.model.id.toLowerCase().startsWith("qwen") ? QWEN : NONE
  // Only Anthropic's own route: other Messages-compatible endpoints may cache and bill breakpoints differently.
  if (route === "anthropic-messages") return ANTHROPIC
  return AUTO
}

const ANTHROPIC: Placement = { ...AUTO, previousTail: true }
