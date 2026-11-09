/** What `powerMonitor.getSystemIdleState` reports. `locked` only where the OS supports it. */
export type IdleState = "active" | "idle" | "locked" | "unknown"

/**
 * Whether the user is away from this desktop. `screen` is the lock screen (or sleep, which locks it on wake), `away`
 * is a macOS switch to another login session, which the idle state cannot see.
 */
export type ScreenLockState = { readonly screen: boolean; readonly away: boolean }

export type ScreenLockEvent =
  /** `lock-screen` or `unlock-screen` (macOS, Windows). */
  | { readonly type: "screen"; readonly locked: boolean }
  /** `user-did-resign-active` or `user-did-become-active` (macOS). */
  | { readonly type: "session"; readonly active: boolean }
  /** The system is going to sleep. */
  | { readonly type: "suspended" }
  /** The system woke; the idle state decides, and one that cannot tell counts as unlocked. */
  | { readonly type: "resumed"; readonly idle: IdleState }
  /** A periodic read of the idle state, the only lock signal on Linux. `unknown` changes nothing. */
  | { readonly type: "probed"; readonly idle: IdleState }

export const initialScreenLockState: ScreenLockState = Object.freeze({ screen: false, away: false })

export function transitionScreenLock(state: ScreenLockState, event: ScreenLockEvent): ScreenLockState {
  if (event.type === "screen") return screen(state, event.locked)

  if (event.type === "session") return state.away === !event.active ? state : { ...state, away: !event.active }

  if (event.type === "suspended") return screen(state, true)

  if (event.type === "resumed") return screen(state, event.idle === "locked")

  if (event.idle === "unknown") return state

  return screen(state, event.idle === "locked")
}

export function isScreenLocked(state: ScreenLockState) {
  return state.screen || state.away
}

function screen(state: ScreenLockState, locked: boolean) {
  return state.screen === locked ? state : { ...state, screen: locked }
}
