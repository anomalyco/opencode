/** The longest the inbox hides behind its loader on first open, so one stalled server cannot hide every other one. */
export const INBOX_SETTLE_TIMEOUT_MS = 10_000

/** A working root's pending-request check: claimed before the request starts, so a rerun never sends it again. */
export type InboxRequestCheck = "checking" | "checked"

type Checks = Readonly<Record<string, InboxRequestCheck>>

/**
 * The inbox's first load. It waits for each usable server's index and activity snapshot and each working root's
 * requests, or for the reveal timer to fire. A session starting after it settles never blanks the inbox.
 * Request checks keep running after it settles.
 */
export type InboxSettleState =
  | {
      readonly status: "loading"
      readonly hydrated: boolean
      readonly serversSettled: boolean
      readonly timerArmed: boolean
      readonly workingKeys: readonly string[]
      readonly checks: Checks
    }
  | { readonly status: "settled"; readonly checks: Checks }
  | { readonly status: "disposed" }

export type InboxSettleEvent =
  | {
      readonly type: "sync"
      readonly hydrated: boolean
      readonly serversSettled: boolean
      readonly workingKeys: readonly string[]
    }
  | { readonly type: "requests.settled"; readonly key: string }
  | { readonly type: "reveal.timed-out" }
  | { readonly type: "disposed" }

export type InboxSettleEffect =
  | { readonly type: "requests.sync"; readonly key: string }
  | { readonly type: "reveal-timer.start"; readonly timeoutMs: number }
  | { readonly type: "reveal-timer.clear" }

export type InboxSettleTransition = {
  readonly state: InboxSettleState
  readonly effects: readonly InboxSettleEffect[]
}

export const INITIAL_INBOX_SETTLE_STATE: InboxSettleState = Object.freeze({
  status: "loading",
  hydrated: false,
  serversSettled: false,
  timerArmed: false,
  workingKeys: Object.freeze([]),
  checks: Object.freeze({}),
})

const DISPOSED: InboxSettleState = Object.freeze({ status: "disposed" })

const NONE: readonly InboxSettleEffect[] = []

export function transitionInboxSettle(state: InboxSettleState, event: InboxSettleEvent): InboxSettleTransition {
  if (state.status === "disposed") return unchanged(state)

  const clear: readonly InboxSettleEffect[] =
    state.status === "loading" && state.timerArmed ? [{ type: "reveal-timer.clear" }] : NONE

  if (event.type === "disposed") return { state: DISPOSED, effects: clear }

  if (event.type === "reveal.timed-out") {
    if (state.status !== "loading" || !state.timerArmed) return unchanged(state)

    return { state: { status: "settled", checks: state.checks }, effects: NONE }
  }

  if (event.type === "requests.settled") {
    if (state.checks[event.key] !== "checking") return unchanged(state)
    const checks = { ...state.checks, [event.key]: "checked" as const }

    if (state.status === "settled") return { state: { status: "settled", checks }, effects: NONE }

    if (ready(state.hydrated, state.serversSettled, state.workingKeys, checks))
      return { state: { status: "settled", checks }, effects: clear }

    return { state: { ...state, checks }, effects: NONE }
  }

  const workingKeys = [...new Set(event.workingKeys)]
  const added = workingKeys.filter((key) => !state.checks[key])

  const checks: Checks = added.length
    ? { ...state.checks, ...Object.fromEntries(added.map((key) => [key, "checking" as const])) }
    : state.checks

  const sync = added.map((key): InboxSettleEffect => ({ type: "requests.sync", key }))

  if (state.status === "settled") {
    if (!added.length) return unchanged(state)

    return { state: { status: "settled", checks }, effects: sync }
  }

  if (ready(event.hydrated, event.serversSettled, workingKeys, checks))
    return { state: { status: "settled", checks }, effects: [...sync, ...clear] }

  if (
    !added.length &&
    state.timerArmed &&
    state.hydrated === event.hydrated &&
    state.serversSettled === event.serversSettled &&
    same(state.workingKeys, workingKeys)
  )
    return unchanged(state)

  return {
    state: {
      status: "loading",
      hydrated: event.hydrated,
      serversSettled: event.serversSettled,
      timerArmed: true,
      workingKeys,
      checks,
    },
    effects: state.timerArmed ? sync : [...sync, { type: "reveal-timer.start", timeoutMs: INBOX_SETTLE_TIMEOUT_MS }],
  }
}

/** The first load has not settled: lists would still move or claim nothing needs you. */
export function selectInboxLoading(state: InboxSettleState) {
  return state.status === "loading"
}

function ready(hydrated: boolean, serversSettled: boolean, workingKeys: readonly string[], checks: Checks) {
  return hydrated && serversSettled && workingKeys.every((key) => checks[key] === "checked")
}

function same(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

function unchanged(state: InboxSettleState): InboxSettleTransition {
  return { state, effects: NONE }
}
