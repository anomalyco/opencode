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

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message["role"], before: number): number =>
  messages.findLastIndex((m, i) => i < before && m.role === role)

type CacheablePart = Exclude<ContentPart, { readonly type: "compaction" | "effort" }>

const isCacheablePart = (part: ContentPart): part is CacheablePart =>
  part.type !== "compaction" && part.type !== "effort"

// Mark the last text part of `messages[index]`, among its first `parts` parts when given. If no text part
// exists, mark the last cacheable content part — that's the breakpoint position
// in tool-result-only messages too.
const markMessageAt = (
  messages: ReadonlyArray<Message>,
  index: number,
  hint: CacheHint,
  budget: Budget,
  parts?: number,
): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages
  const target = messages[index]!
  const content = parts === undefined ? target.content : target.content.slice(0, parts)
  if (content.length === 0) return messages
  const lastTextIndex = content.findLastIndex((part) => part.type === "text")
  const markAt = lastTextIndex >= 0 ? lastTextIndex : content.findLastIndex(isCacheablePart)
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

const isTransient = (part: ContentPart) => part.type === "text" && part.transient === true

// Where request-local content starts: the message holding the first transient part, and that part's index in it.
// The next request no longer sends that content, so a breakpoint on or after it would write an entry nothing reads.
const requestLocalStart = (messages: ReadonlyArray<Message>) => {
  const message = messages.findIndex((item) => item.content.some(isTransient))
  if (message < 0) return { message: messages.length, part: 0 }
  const part = messages[message]!.content.findIndex(isTransient)
  if (part > 0 && messages[message]!.role !== "system") return { message, part }
  // Anthropic lowers a system update that user content follows differently from one that a reply follows, so the
  // next request sends it in another form. End before such an update so the next request still reads this tail.
  const previous = messages.findLastIndex((item, i) => i < message && effortUpdate(item) === undefined)
  if (messages[previous]?.role !== "system") return { message, part: 0 }
  return { message: messages.findLastIndex((item, i) => i < message && item.role !== "system") + 1, part: 0 }
}

const markMessages = (
  messages: ReadonlyArray<Message>,
  strategy: NonNullable<CachePolicyObject["messages"]>,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  const local = requestLocalStart(messages)
  // Messages before `end` repeat in later requests; so does the start of a message whose tail is request-local.
  const end = local.part > 0 ? local.message + 1 : local.message
  const mark = (next: ReadonlyArray<Message>, index: number) =>
    markMessageAt(next, index, hint, budget, index === local.message ? local.part : undefined)
  if (end === 0) return messages
  if (strategy === "latest-user-message") return mark(messages, lastIndexOfRole(messages, "user", end))
  if (strategy === "latest-assistant") return mark(messages, lastIndexOfRole(messages, "assistant", end))
  let start = end
  let remaining = strategy.tail
  while (remaining > 0 && start > 0) {
    start -= 1
    if (effortUpdate(messages[start]!) === undefined) remaining -= 1
  }
  let next = messages
  for (let i = start; i < end; i++) if (effortUpdate(messages[i]!) === undefined) next = mark(next, i)
  return next
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

// A declared cache format overrides the route allowlist and its model-ID heuristics.
const selectPolicy = (request: LLMRequest): CachePolicyObject => {
  const format = request.model.compatibility?.cacheFormat
  const route = request.model.route.id
  const auto = isAuto(request.cache)
  if (format === "alibaba") return auto ? QWEN : { ...resolve(request.cache), tools: false }
  if (format === "anthropic") return resolve(request.cache)
  if (!RESPECTS_INLINE_HINTS.has(route)) return NONE
  if (!auto) return resolve(request.cache)
  if (route === "openrouter" || route === "vercel-ai-gateway-messages") return gatewayPolicy(request.model.id)
  if (route === "alibaba-chat") return request.model.id.toLowerCase().startsWith("qwen") ? QWEN : NONE
  return AUTO
}
