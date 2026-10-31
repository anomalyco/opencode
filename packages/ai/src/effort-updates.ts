// Changing the top-level reasoning effort invalidates the provider prompt cache. Protocols with a native
// per-message update freeze the top-level effort to the first recorded assistant reply and emit markers
// at the start of each later segment whose effort changed.
import type { LLMRequest } from "./schema/messages.js"

export const resolveEffortUpdates = (
  request: LLMRequest,
  requested: string | undefined,
  defaultEffort: string,
): { readonly effort: string | undefined; readonly markers: ReadonlyMap<number, string> } => {
  const markers = new Map<number, string>()
  if (!(request.model.route.supportsEffortUpdates?.(request) ?? false)) return { effort: requested, markers }
  const first = request.messages.find((message) => message.role === "assistant" && message.effort !== undefined)
  if (first === undefined) return { effort: requested, markers }

  const baseline = first.effort ?? null
  const desired = requested ?? null
  const messages = request.messages
  let active = baseline
  let segmentStart = 0
  let prefilled = false

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (message.role !== "assistant") continue
    let nextStart = i + 1
    while (nextStart < messages.length && messages[nextStart]!.role === "tool") nextStart++
    const isTrailingPrefill = message.effort === undefined && nextStart === messages.length
    const target = isTrailingPrefill ? desired : message.effort
    if (target !== undefined && segmentStart > 0 && target !== active) {
      markers.set(segmentStart, target ?? defaultEffort)
      active = target
    }
    if (isTrailingPrefill) prefilled = true
    segmentStart = nextStart
    i = nextStart - 1
  }
  if (!prefilled && segmentStart > 0 && desired !== active) {
    markers.set(segmentStart, desired ?? defaultEffort)
  }

  return { effort: baseline ?? undefined, markers }
}
