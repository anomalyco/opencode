export type ForceFocusReply = {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

export type ForceFocusRequest = {
  readonly enabled: boolean
  readonly reply: ForceFocusReply
}

type Busy = {
  readonly attempt: number
  readonly owned: boolean
  readonly nodeIds: readonly number[]
  readonly desired: boolean
  readonly requests: readonly ForceFocusRequest[]
}

/**
 * Forced `:focus` styles on one window's WebContents. One CDP command runs at a time: `enabling` and `disabling` hold
 * the requests that arrive meanwhile, and `desired` is the latest of them, applied once the running command settles.
 * `owned` is true when force focus attached the debugger itself and must detach it; false when another client had
 * attached it first. `nodeIds` are the nodes forced so far.
 */
export type ForceFocusState =
  | { readonly status: "off"; readonly attempt: number }
  | { readonly status: "on"; readonly attempt: number; readonly owned: boolean; readonly nodeIds: readonly number[] }
  | (Busy & { readonly status: "enabling" })
  | (Busy & { readonly status: "disabling" })
  | { readonly status: "disposed" }

export type ForceFocusEvent =
  | { readonly type: "request"; readonly request: ForceFocusRequest }
  | { readonly type: "debugger.attached"; readonly attempt: number }
  | { readonly type: "enable.succeeded"; readonly attempt: number; readonly nodeIds: readonly number[] }
  | { readonly type: "enable.failed"; readonly attempt: number; readonly error: Error }
  | { readonly type: "disable.settled"; readonly attempt: number }
  | { readonly type: "timed-out"; readonly attempt: number }
  | { readonly type: "debugger.detached" }
  | { readonly type: "destroyed" }

export type ForceFocusCommand =
  | { readonly type: "enable"; readonly attempt: number }
  | { readonly type: "disable"; readonly attempt: number; readonly owned: boolean; readonly nodeIds: readonly number[] }
  | { readonly type: "detach" }
  | { readonly type: "cancel-timer" }
  | { readonly type: "settle"; readonly replies: readonly ForceFocusReply[]; readonly error?: Error }

export type ForceFocusTransition = {
  readonly state: ForceFocusState
  readonly commands: readonly ForceFocusCommand[]
}

export const initialForceFocusState: ForceFocusState = Object.freeze({ status: "off", attempt: 0 })

export function transitionForceFocus(state: ForceFocusState, event: ForceFocusEvent): ForceFocusTransition {
  if (state.status === "disposed") {
    if (event.type !== "request") return unchanged(state)

    return { state, commands: settleSplit([event.request], new Error("Window closed")) }
  }

  switch (event.type) {
    case "request": {
      const request = event.request
      const attempt = state.attempt + 1

      if (state.status === "enabling" || state.status === "disabling") {
        return {
          state: { ...state, desired: request.enabled, requests: [...state.requests, request] },
          commands: [],
        }
      }

      if (state.status === "off" && !request.enabled) return { state, commands: settle([request]) }

      const owned = state.status === "on" && state.owned
      const nodeIds = state.status === "on" ? state.nodeIds : []

      // Turning on again from `on` forces the nodes rendered since.
      if (request.enabled) {
        return {
          state: { status: "enabling", attempt, owned, nodeIds, desired: true, requests: [request] },
          commands: [{ type: "enable", attempt }],
        }
      }

      return {
        state: { status: "disabling", attempt, owned, nodeIds, desired: false, requests: [request] },
        commands: [{ type: "disable", attempt, owned, nodeIds }],
      }
    }

    case "debugger.attached": {
      if (state.status !== "enabling" || state.attempt !== event.attempt || state.owned) return unchanged(state)

      return { state: { ...state, owned: true }, commands: [] }
    }

    case "enable.succeeded": {
      if (state.status !== "enabling" || state.attempt !== event.attempt) return unchanged(state)
      const nodeIds = [...new Set([...state.nodeIds, ...event.nodeIds])]

      if (state.desired) {
        return {
          state: { status: "on", attempt: state.attempt, owned: state.owned, nodeIds },
          commands: [{ type: "cancel-timer" }, ...settle(state.requests)],
        }
      }

      // Turned off while turning on: the requests to turn on are done, the ones to turn off wait for the reset.
      const attempt = state.attempt + 1

      return {
        state: { ...state, status: "disabling", attempt, nodeIds, requests: wanting(state.requests, false) },
        commands: [...settle(wanting(state.requests, true)), { type: "disable", attempt, owned: state.owned, nodeIds }],
      }
    }

    case "enable.failed": {
      if (state.status !== "enabling" || state.attempt !== event.attempt) return unchanged(state)

      return failEnable(state, event.error)
    }

    case "disable.settled": {
      if (state.status !== "disabling" || state.attempt !== event.attempt) return unchanged(state)

      return finishDisable(state, [])
    }

    case "timed-out": {
      if (state.status === "enabling" && state.attempt === event.attempt) {
        return failEnable(state, new Error("Timed out forcing focus styles"))
      }

      if (state.status !== "disabling" || state.attempt !== event.attempt) return unchanged(state)

      return finishDisable(state, state.owned ? [{ type: "detach" }] : [])
    }

    case "debugger.detached": {
      // Another client detached the debugger, which drops every forced style with it.
      if (state.status === "off") return unchanged(state)

      if (state.status === "on") return { state: { status: "off", attempt: state.attempt }, commands: [] }

      if (state.status === "disabling") return finishDisable(state, [])

      return {
        state: { status: "off", attempt: state.attempt },
        commands: [{ type: "cancel-timer" }, ...settleSplit(state.requests, new Error("Debugger detached"))],
      }
    }

    case "destroyed": {
      if (state.status === "off" || state.status === "on") return { state: { status: "disposed" }, commands: [] }

      return {
        state: { status: "disposed" },
        commands: [{ type: "cancel-timer" }, ...settleSplit(state.requests, new Error("Window closed"))],
      }
    }
  }
}

/** Whether a CDP command for `attempt` still belongs to the live state. */
export function isCurrentForceFocusAttempt(state: ForceFocusState, attempt: number) {
  return (state.status === "enabling" || state.status === "disabling") && state.attempt === attempt
}

// A failed enable rolls back: detach a debugger it attached, else clear the nodes it forced before.
function failEnable(state: Busy, error: Error): ForceFocusTransition {
  const settled = settleSplit(state.requests, error)

  if (state.owned) {
    return {
      state: { status: "off", attempt: state.attempt },
      commands: [{ type: "cancel-timer" }, { type: "detach" }, ...settled],
    }
  }

  if (state.nodeIds.length === 0) {
    return { state: { status: "off", attempt: state.attempt }, commands: [{ type: "cancel-timer" }, ...settled] }
  }

  const attempt = state.attempt + 1

  return {
    state: { status: "disabling", attempt, owned: false, nodeIds: state.nodeIds, desired: false, requests: [] },
    commands: [...settled, { type: "disable", attempt, owned: false, nodeIds: state.nodeIds }],
  }
}

// Every forced style is cleared and an owned debugger detached; turn on again if a request asked for it meanwhile.
function finishDisable(state: Busy, commands: readonly ForceFocusCommand[]): ForceFocusTransition {
  if (!state.desired) {
    return {
      state: { status: "off", attempt: state.attempt },
      commands: [{ type: "cancel-timer" }, ...commands, ...settle(state.requests)],
    }
  }

  const attempt = state.attempt + 1

  return {
    state: {
      status: "enabling",
      attempt,
      owned: false,
      nodeIds: [],
      desired: true,
      requests: wanting(state.requests, true),
    },
    commands: [...commands, ...settle(wanting(state.requests, false)), { type: "enable", attempt }],
  }
}

function wanting(requests: readonly ForceFocusRequest[], enabled: boolean) {
  return requests.filter((request) => request.enabled === enabled)
}

// Requests to turn off are met when force focus ends up off; requests to turn on fail with `error`.
function settleSplit(requests: readonly ForceFocusRequest[], error: Error) {
  return [...settle(wanting(requests, false)), ...settle(wanting(requests, true), error)]
}

// Resolves the requests' replies, or rejects them with `error`.
function settle(requests: readonly ForceFocusRequest[], error?: Error): ForceFocusCommand[] {
  const replies = requests.map((request) => request.reply)

  if (replies.length === 0) return []

  if (!error) return [{ type: "settle", replies }]

  return [{ type: "settle", replies, error }]
}

function unchanged(state: ForceFocusState): ForceFocusTransition {
  return { state, commands: [] }
}
