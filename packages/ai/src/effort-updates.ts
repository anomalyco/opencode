// Changing a top-level reasoning effort invalidates the whole provider prompt
// cache, so a mid-conversation switch is recorded as a `Message.effort(...)`
// marker instead. Protocols with a native per-message update (Anthropic
// per-turn `output_config`, OpenAI Responses `configuration_update`) freeze the
// top-level effort at the pre-switch value and lower each marker in place;
// every other route has the markers stripped here, before `applyCachePolicy`.
import { LLMRequest, type EffortPart, type Message } from "./schema/messages.js"

/** The marker `Message.effort(...)` produces: a system message holding exactly one effort part. */
export const effortUpdate = (message: Message): EffortPart | undefined => {
  if (message.role !== "system" || message.content.length !== 1) return undefined
  const part = message.content[0]
  return part.type === "effort" ? part : undefined
}

export const stripEffortUpdates = (request: LLMRequest) => {
  const messages = request.messages.filter((message) => effortUpdate(message) === undefined)
  return messages.length === request.messages.length ? request : LLMRequest.update(request, { messages })
}

export const applyEffortUpdates = (request: LLMRequest): LLMRequest =>
  request.model.route.supportsEffortUpdates?.(request) ? request : stripEffortUpdates(request)

/**
 * Decide the top-level effort a protocol sends alongside the markers. When the
 * markers end at `current`, the effort the request asks for today, the top
 * level stays at the first marker's `previous` so the cached prefix is
 * untouched. The check is required, not defensive: `revert.ts` never touches
 * `session.model`, forks may select a different variant, and variant IDs in the
 * effort vocabulary need not be effort options. On disagreement the markers are
 * stripped and the request falls back to a plain top-level change. That is
 * silent by design: the cache is lost and nothing signals it.
 */
export const resolveEffortUpdates = (request: LLMRequest, current: string | undefined) => {
  const updates = request.messages.flatMap((message) => effortUpdate(message) ?? [])
  if (updates.length === 0) return { request, effort: current }
  if (updates.at(-1)?.effort !== current) return { request: stripEffortUpdates(request), effort: current }
  return { request, effort: updates[0]?.previous }
}
