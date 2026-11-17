/** What `powerMonitor.getSystemIdleState` reports. `locked` only where the OS supports it. */
export type IdleState = "active" | "idle" | "locked" | "unknown"

/**
 * Whether the user is away from this desktop.
 *
 * `screen` is an explicit lock-screen event, `sleeping` is a suspend not yet followed by resume, `away` is a macOS switch
 * to another login session, `probed` is the idle-state fallback, and `bus` is the Linux login1/elogind hint. Each
 * source stays separate so one source going quiet or reporting unlocked cannot clear another's lock.
 */
export type ScreenLockState = {
  readonly screen: boolean
  readonly away: boolean
  readonly sleeping: boolean
  readonly probed: boolean
  /** Linux login1/elogind: undefined while no watcher is available. */
  readonly bus: boolean | undefined
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
  /** A periodic read of the idle state, the fallback when no Linux bus watcher is available. `unknown` changes nothing. */
  | { readonly type: "probed"; readonly idle: IdleState }
  /** A Linux login1/elogind hint; undefined clears its contribution when the watcher stops. */
  | { readonly type: "bus"; readonly locked: boolean | undefined }

export const initialScreenLockState: ScreenLockState = Object.freeze({
  screen: false,
  away: false,
  sleeping: false,
  probed: false,
  bus: undefined,
})

export function transitionScreenLock(state: ScreenLockState, event: ScreenLockEvent): ScreenLockState {
  if (event.type === "screen") return screen(state, event.locked)

  if (event.type === "session") return state.away === !event.active ? state : { ...state, away: !event.active }

  if (event.type === "bus") return state.bus === event.locked ? state : { ...state, bus: event.locked }

  if (event.type === "suspended") return state.sleeping ? state : { ...state, sleeping: true }

  if (event.type === "resumed")
    return same(state, {
      ...state,
      sleeping: false,
      probed: event.idle === "unknown" ? state.probed : event.idle === "locked",
    })

  if (event.idle === "unknown") return state

  // An explicit lock, sleep or another login session outranks the idle probe.
  if (state.screen || state.sleeping || state.away) return state

  return same(state, { ...state, probed: event.idle === "locked" })
}

export function isScreenLocked(state: ScreenLockState) {
  return state.screen || state.away || state.sleeping || state.probed || state.bus === true
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
    previous.probed === next.probed &&
    previous.bus === next.bus
    ? previous
    : next
}
