export type PromptQueueFlushState = { armed: boolean }

export function shouldFlushPromptQueueOnStatus(
  state: PromptQueueFlushState,
  input: { sessionID?: string; statusType: string; queueLength: number },
) {
  if (input.statusType !== "idle") {
    state.armed = true
    return false
  }
  if (!state.armed) return false
  state.armed = false
  return Boolean(input.sessionID && input.queueLength > 0)
}
