// A top-level reasoning effort change invalidates the whole provider prompt cache, so a
// mid-conversation switch travels as a `Message.effort(...)` marker: protocols with a native
// per-message update freeze the top-level effort and lower the markers; every other route strips them.
import { LLMRequest, type EffortPart, type Message } from "./schema/messages.js"

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

// The markers must end at `current`: `revert.ts` never touches `session.model` and forks may select
// another variant, so on disagreement fall back to a plain top-level change instead of misreporting effort.
export const resolveEffortUpdates = (request: LLMRequest, current: string | undefined) => {
  const updates = request.messages.flatMap((message) => effortUpdate(message) ?? [])
  if (updates.length === 0) return { request, effort: current }
  if (updates.at(-1)?.effort !== current) return { request: stripEffortUpdates(request), effort: current }
  return { request, effort: updates[0]?.previous }
}
