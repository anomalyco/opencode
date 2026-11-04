/** A user-message action: `queue` and `remove` act on a pending steer, `revert` and `fork` on a delivered message. */
export type MessageAction = "queue" | "remove" | "revert" | "fork"

/** What the message offers right now: the host's actions and whether the server has delivered the message yet. */
export type MessageActionCapabilities = {
  readonly pending: boolean
  readonly canPending: boolean
  readonly canRevert: boolean
  readonly canFork: boolean
}

/** At most one action runs per message; `attempts` counts started actions so a late result cannot settle a newer one. */
export type MessageActionState =
  | { readonly status: "idle"; readonly attempts: number }
  | { readonly status: "running"; readonly action: MessageAction; readonly attempt: number }

export type MessageActionEvent =
  | { readonly type: "requested"; readonly action: MessageAction; readonly capabilities: MessageActionCapabilities }
  | { readonly type: "succeeded"; readonly attempt: number }
  | { readonly type: "failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type MessageActionEffect = { readonly type: "run"; readonly action: MessageAction; readonly attempt: number }

export type MessageActionTransition = {
  readonly state: MessageActionState
  readonly effects: readonly MessageActionEffect[]
}

export function createMessageActionState(): MessageActionState {
  return { status: "idle", attempts: 0 }
}

export function transitionMessageAction(state: MessageActionState, event: MessageActionEvent): MessageActionTransition {
  if (event.type === "requested") {
    if (state.status === "running" || !canStart(event.action, event.capabilities)) return { state, effects: [] }
    const attempt = state.attempts + 1

    return {
      state: { status: "running", action: event.action, attempt },
      effects: [{ type: "run", action: event.action, attempt }],
    }
  }

  if (state.status === "idle") return { state, effects: [] }

  // A failure settles like a success: the host reports the error, and the message's actions stay usable.
  if (event.type !== "disposed" && event.attempt !== state.attempt) return { state, effects: [] }

  return { state: { status: "idle", attempts: state.attempt }, effects: [] }
}

export function viewMessageActions(state: MessageActionState, capabilities: MessageActionCapabilities) {
  const disabled = (action: MessageAction) => state.status === "running" || !canStart(action, capabilities)

  return {
    disabled: {
      queue: disabled("queue"),
      remove: disabled("remove"),
      revert: disabled("revert"),
      fork: disabled("fork"),
    },
  }
}

function canStart(action: MessageAction, capabilities: MessageActionCapabilities) {
  if (action === "queue" || action === "remove") return capabilities.canPending && capabilities.pending

  if (action === "revert") return capabilities.canRevert && !capabilities.pending

  return capabilities.canFork && !capabilities.pending
}
