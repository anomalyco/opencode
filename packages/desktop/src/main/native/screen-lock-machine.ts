/** What `powerMonitor.getSystemIdleState` reports. `locked` only where the OS supports it. */
export type IdleState = "active" | "idle" | "locked" | "unknown"

/**
 * Whether the user is away from this desktop.
 *
 * `screen` is an explicit lock-screen event, `sleeping` is a suspend not yet followed by resume, `away` is a macOS switch
 * to another login session, and `probed` is the idle-state fallback (the only signal on Linux). An explicit lock or
 * sleep is authoritative: a probe can never clear it.
 */
export type ScreenLockState = {
  readonly screen: boolean
  readonly away: boolean
  readonly sleeping: boolean
  readonly probed: boolean
}

export type ScreenLockEvent =
  /** `lock-screen` or `unlock-screen` (macOS, Windows). */
  | { readonly type: "screen"; readonly locked: boolean }
  /** `user-did-resign-active` or `user-did-become-active` (macOS). */
  | { readonly type: "session"; readonly active: boolean }
  /** The system is going to sleep. */
  | { readonly type: "suspended" }
  /** The system woke; the idle state decides unless an explicit lock event is still in force. */
  | { readonly type: "resumed"; readonly idle: IdleState }
  /** A periodic read of the idle state, the only lock signal on Linux. `unknown` changes nothing. */
  | { readonly type: "probed"; readonly idle: IdleState }

export const initialScreenLockState: ScreenLockState = Object.freeze({
  screen: false,
  away: false,
  sleeping: false,
  probed: false,
})

export function transitionScreenLock(state: ScreenLockState, event: ScreenLockEvent): ScreenLockState {
  if (event.type === "screen") return screen(state, event.locked)

  if (event.type === "session") return state.away === !event.active ? state : { ...state, away: !event.active }

  if (event.type === "suspended") return state.sleeping ? state : { ...state, sleeping: true }

  if (event.type === "resumed") return same(state, { ...state, sleeping: false, probed: event.idle === "locked" })

  if (event.idle === "unknown") return state

  // An explicit lock, sleep or another login session outranks the idle probe.
  if (state.screen || state.sleeping || state.away) return state

  return same(state, { ...state, probed: event.idle === "locked" })
}

export function isScreenLocked(state: ScreenLockState) {
  return state.screen || state.away || state.sleeping || state.probed
}

function screen(state: ScreenLockState, locked: boolean): ScreenLockState {
  if (locked) return state.screen ? state : { ...state, screen: true }

  // An explicit unlock clears the fallback too; a stale probe must not hold the screen locked.
  if (!state.screen && !state.probed && !state.sleeping) return state

  return { ...state, screen: false, sleeping: false, probed: false }
}

function same(previous: ScreenLockState, next: ScreenLockState) {
  return previous.screen === next.screen &&
    previous.away === next.away &&
    previous.sleeping === next.sleeping &&
    previous.probed === next.probed
    ? previous
    : next
}
