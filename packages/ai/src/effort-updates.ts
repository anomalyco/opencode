// Changing the top-level reasoning effort invalidates the provider prompt cache. Protocols with a native
// per-message update freeze the top-level effort to the first recorded assistant reply and emit markers
// at the start of each later segment whose effort changed.
import type { LLMRequest, Message } from "./schema/messages.js"

export const resolveEffortUpdates = (
  request: LLMRequest,
  requested: string | undefined,
  defaultEffort: string,
  validEffort?: (effort: string) => boolean,
) => {
  const markers = new Map<number, string>()
  const messages = request.messages
  const effortOf = (message: Message) =>
    typeof message.effort === "string" && validEffort && !validEffort(message.effort) ? undefined : message.effort
  const first = messages.find((message) => message.role === "assistant" && effortOf(message) !== undefined)
  const baseline = first ? effortOf(first) : undefined
  if (baseline === undefined || !request.model.route.supportsEffortUpdates?.(request))
    return { effort: requested, markers }
  const desired = requested ?? null
  let active = baseline
  let start = 0
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== "assistant") continue
    let next = i + 1
    while (messages[next]?.role === "tool") next++
    // A trailing unstamped assistant is a prefill for the reply being requested.
    const recorded = effortOf(messages[i]!)
    const target = recorded !== undefined ? recorded : next === messages.length ? desired : undefined
    if (target !== undefined && target !== active) {
      markers.set(start, target ?? defaultEffort)
      active = target
    }
    start = next
    i = next - 1
  }
  if (desired !== active) markers.set(start, desired ?? defaultEffort)
  return { effort: baseline ?? undefined, markers }
}
