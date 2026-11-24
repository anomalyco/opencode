/**
 * The first renderer's burst of asset requests, which the entry module waits out before it evaluates the main bundle
 * on the thread that serves them. The burst is answered once no request has been in flight for `quietMs` after the
 * last one finished, or `capMs` after the wait began. Once settled, requests are no longer tracked.
 */
export type ProtocolBurstState =
  /** Nobody waits yet; requests are counted so a wait can start from where the burst stands. */
  | { readonly status: "idle"; readonly inflight: number; readonly served: boolean }
  /** The renderer has not asked for anything yet; only the cap ends the wait. */
  | { readonly status: "awaiting-first"; readonly quietMs: number; readonly replies: readonly (() => void)[] }
  | {
      readonly status: "serving"
      readonly inflight: number
      readonly quietMs: number
      readonly attempt: number
      readonly replies: readonly (() => void)[]
    }
  /** Every request finished; the quiet timer `attempt` runs. */
  | {
      readonly status: "quiet"
      readonly quietMs: number
      readonly attempt: number
      readonly replies: readonly (() => void)[]
    }
  | { readonly status: "settled" }

export type ProtocolBurstEvent =
  | { readonly type: "wait.requested"; readonly quietMs: number; readonly capMs: number; readonly reply: () => void }
  | { readonly type: "request.started" }
  | { readonly type: "request.finished" }
  | { readonly type: "quiet.elapsed"; readonly attempt: number }
  | { readonly type: "cap.elapsed" }
  /** The first window closed, so the app quits and nothing waits for its assets. */
  | { readonly type: "cancelled" }

export type ProtocolBurstCommand =
  | { readonly type: "start-cap-timer"; readonly delayMs: number }
  | { readonly type: "start-quiet-timer"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-quiet-timer" }
  | { readonly type: "clear-timers" }
  | { readonly type: "resolve"; readonly replies: readonly (() => void)[] }

export type ProtocolBurstTransition = {
  readonly state: ProtocolBurstState
  readonly commands: readonly ProtocolBurstCommand[]
}

const SETTLED: ProtocolBurstState = Object.freeze({ status: "settled" })

export function createProtocolBurstState(): ProtocolBurstState {
  return { status: "idle", inflight: 0, served: false }
}

export function transitionProtocolBurst(state: ProtocolBurstState, event: ProtocolBurstEvent): ProtocolBurstTransition {
  if (state.status === "settled")
    return event.type === "wait.requested"
      ? unchanged(state, [{ type: "resolve", replies: [event.reply] }])
      : unchanged(state)

  if (state.status === "idle") return idle(state, event)

  switch (event.type) {
    case "wait.requested":
      return to({ ...state, replies: [...state.replies, event.reply] })

    case "cap.elapsed":
    case "cancelled":
      return settle(state.replies)

    case "request.started":
      if (state.status === "serving") return to({ ...state, inflight: state.inflight + 1 })

      return {
        state: {
          status: "serving",
          inflight: 1,
          quietMs: state.quietMs,
          attempt: state.status === "quiet" ? state.attempt : 0,
          replies: state.replies,
        },
        commands: state.status === "quiet" ? [{ type: "cancel-quiet-timer" }] : [],
      }

    case "request.finished":
      if (state.status !== "serving") return unchanged(state)

      if (state.inflight > 1) return to({ ...state, inflight: state.inflight - 1 })

      // The quiet window starts when the last request finished, not when it started: a slow read of the HTML leaves
      // the renderer no time yet to ask for the scripts it names.
      return quiet(state.quietMs, state.attempt + 1, state.replies)

    case "quiet.elapsed":
      if (state.status !== "quiet" || state.attempt !== event.attempt) return unchanged(state)

      return settle(state.replies)
  }
}

function idle(
  state: Extract<ProtocolBurstState, { status: "idle" }>,
  event: ProtocolBurstEvent,
): ProtocolBurstTransition {
  switch (event.type) {
    case "request.started":
      return to({ ...state, inflight: state.inflight + 1 })

    case "request.finished":
      if (state.inflight === 0) return unchanged(state)

      return to({ ...state, inflight: state.inflight - 1, served: true })

    case "cancelled":
      return to(SETTLED)

    case "wait.requested": {
      const cap: ProtocolBurstCommand = { type: "start-cap-timer", delayMs: event.capMs }

      if (state.inflight > 0)
        return {
          state: {
            status: "serving",
            inflight: state.inflight,
            quietMs: event.quietMs,
            attempt: 0,
            replies: [event.reply],
          },
          commands: [cap],
        }

      if (state.served) {
        const next = quiet(event.quietMs, 1, [event.reply])

        return { state: next.state, commands: [cap, ...next.commands] }
      }

      return {
        state: { status: "awaiting-first", quietMs: event.quietMs, replies: [event.reply] },
        commands: [cap],
      }
    }
  }

  return unchanged(state)
}

function quiet(quietMs: number, attempt: number, replies: readonly (() => void)[]): ProtocolBurstTransition {
  return {
    state: { status: "quiet", quietMs, attempt, replies },
    commands: [{ type: "start-quiet-timer", attempt, delayMs: quietMs }],
  }
}

function settle(replies: readonly (() => void)[]): ProtocolBurstTransition {
  return { state: SETTLED, commands: [{ type: "clear-timers" }, { type: "resolve", replies }] }
}

function to(state: ProtocolBurstState): ProtocolBurstTransition {
  return { state, commands: [] }
}

function unchanged(state: ProtocolBurstState, commands: readonly ProtocolBurstCommand[] = []): ProtocolBurstTransition {
  return { state, commands }
}

/** Requests after the burst settled are not tracked. */
export const isProtocolBurstSettled = (state: ProtocolBurstState) => state.status === "settled"
