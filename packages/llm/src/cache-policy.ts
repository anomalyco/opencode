// Apply an `LLMRequest.cache` policy by injecting `CacheHint`s onto the parts
// the policy designates. Runs once at compile time, before the per-protocol
// body builder, so the existing inline-hint lowering path handles the rest.
//
// The default `"auto"` shape places one breakpoint at the last tool definition,
// one at the last system part, and one at the latest user message. This
// matches what production agent harnesses (LangChain's caching middleware,
// kern-ai's 10x cost-reduction playbook) converge on for tool-use loops: the
// latest user message stays put while a single turn explodes into many
// assistant/tool round-trips, so caching at that boundary lets every
// intra-turn API call hit the prefix.
//
// Manual `cache: CacheHint` placements on individual parts are preserved —
// this function only fills gaps the caller left empty.
import { CacheHint, type CachePolicy, type CachePolicyObject } from "./schema/options"
import { LLMRequest, Message, ToolDefinition, type ContentPart } from "./schema/messages"

const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: "latest-user-message",
}

const NONE: CachePolicyObject = {}

// Resolution rules:
//   - undefined   → "auto" — caching is on by default. The math favors it:
//                   Anthropic 5m-cache write is 1.25x base, read is 0.1x,
//                   so a single reuse within 5 minutes already wins.
//   - "auto"      → tools + system + latest user msg.
//   - "none"      → no auto placement; manual `CacheHint`s still flow.
//   - object form → exactly what the caller asked for.
const resolve = (policy: CachePolicy | undefined): CachePolicyObject => {
  if (policy === undefined || policy === "auto") return AUTO
  if (policy === "none") return NONE
  return policy
}

// Protocols whose wire format ignores inline cache markers (OpenAI's implicit
// prefix caching, Gemini's implicit + out-of-band CachedContent). Skip the
// whole policy pass for these — emitting hints would be harmless but pointless.
const RESPECTS_INLINE_HINTS = new Set(["anthropic-messages", "bedrock-converse"])

// The part types whose schema declares a `cache` field. Anything else
// (`reasoning`, `media`) discards the hint when the part is rebuilt.
const CACHEABLE_PART_TYPES = new Set(["text", "tool-call", "tool-result"])

const makeHint = (ttlSeconds: number | undefined): CacheHint =>
  ttlSeconds !== undefined ? new CacheHint({ type: "ephemeral", ttlSeconds }) : new CacheHint({ type: "ephemeral" })

const markLastTool = (tools: ReadonlyArray<ToolDefinition>, hint: CacheHint): ReadonlyArray<ToolDefinition> => {
  if (tools.length === 0) return tools
  const last = tools.length - 1
  if (tools[last]!.cache) return tools
  return tools.map((tool, i) => (i === last ? new ToolDefinition({ ...tool, cache: hint }) : tool))
}

const markLastSystem = (system: LLMRequest["system"], hint: CacheHint): LLMRequest["system"] => {
  if (system.length === 0) return system
  const last = system.length - 1
  if (system[last]!.cache) return system
  return system.map((part, i) => (i === last ? { ...part, cache: hint } : part))
}

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message["role"]): number =>
  messages.findLastIndex((m) => m.role === role)

// Mark the last part of `messages[index]` that can hold a `CacheHint`. Only
// `TextPart`, `ToolCallPart` and `ToolResultPart` declare a `cache` field:
// `ReasoningPart` and `MediaPart` do not, so a hint written onto one is dropped
// when the `Message` class rebuilds the part, and the breakpoint the policy
// asked for is silently lost (Anthropic also rejects `cache_control` on a
// `thinking` block outright). Walk back to the last part that can carry it —
// within the message first, then into the preceding ones, because a breakpoint
// one boundary early still caches a prefix where no breakpoint at all caches
// nothing. `index` is the preferred position, not a hard requirement.
const markMessageAt = (messages: ReadonlyArray<Message>, index: number, hint: CacheHint): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages
  for (let i = index; i >= 0; i--) {
    const target = messages[i]!
    const markAt = target.content.findLastIndex((part) => CACHEABLE_PART_TYPES.has(part.type))
    if (markAt < 0) continue
    const existing = target.content[markAt]!
    if ("cache" in existing && existing.cache) return messages
    const nextContent = target.content.map((part, j) => (j === markAt ? ({ ...part, cache: hint } as ContentPart) : part))
    const next = new Message({ ...target, content: nextContent })
    // Single pass over `messages`, substituting the one updated entry. Long
    // conversations call this on every request, so avoid `.map()` here — its
    // closure dispatch and identity copies show up in profiling.
    const result = messages.slice()
    result[i] = next
    return result
  }
  return messages
}

const markMessages = (
  messages: ReadonlyArray<Message>,
  strategy: NonNullable<CachePolicyObject["messages"]>,
  hint: CacheHint,
): ReadonlyArray<Message> => {
  if (messages.length === 0) return messages
  if (strategy === "latest-user-message") return markMessageAt(messages, lastIndexOfRole(messages, "user"), hint)
  if (strategy === "latest-assistant") return markMessageAt(messages, lastIndexOfRole(messages, "assistant"), hint)
  const start = Math.max(0, messages.length - strategy.tail)
  let next = messages
  for (let i = start; i < messages.length; i++) next = markMessageAt(next, i, hint)
  return next
}

export const applyCachePolicy = (request: LLMRequest): LLMRequest => {
  if (!RESPECTS_INLINE_HINTS.has(request.model.route.id)) return request
  const policy = resolve(request.cache)
  if (!policy.tools && !policy.system && !policy.messages) return request

  const hint = makeHint(policy.ttlSeconds)
  const tools = policy.tools ? markLastTool(request.tools, hint) : request.tools
  const system = policy.system ? markLastSystem(request.system, hint) : request.system
  const messages = policy.messages ? markMessages(request.messages, policy.messages, hint) : request.messages

  if (tools === request.tools && system === request.system && messages === request.messages) return request
  return LLMRequest.update(request, { tools, system, messages })
}
