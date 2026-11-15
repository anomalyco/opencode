// The hold behind `keybinds(false)`. `suspend()` leases start at 1, so they never collide with it.
const TOGGLE_HOLD = 0

/**
 * Global command keybind suspension. `holds` is never empty: `0` is the idempotent `keybinds(false)` hold, and
 * `1..issued` are `suspend()` leases, so a caller can only release its own hold.
 */
export type KeybindSuspendState =
  | { readonly status: "active"; readonly issued: number }
  | { readonly status: "suspended"; readonly issued: number; readonly holds: readonly number[] }

export type KeybindSuspendEvent =
  | { readonly type: "suspend" }
  | { readonly type: "resume"; readonly hold: number }
  | { readonly type: "keybinds"; readonly enabled: boolean }

export const INITIAL_KEYBIND_SUSPEND_STATE: KeybindSuspendState = Object.freeze({ status: "active", issued: 0 })

export function transitionKeybindSuspend(state: KeybindSuspendState, event: KeybindSuspendEvent): KeybindSuspendState {
  const holds = state.status === "suspended" ? state.holds : []

  if (event.type === "suspend") {
    const hold = state.issued + 1

    return { status: "suspended", issued: hold, holds: [...holds, hold] }
  }

  if (event.type === "keybinds" && !event.enabled) {
    if (holds.includes(TOGGLE_HOLD)) return state

    return { status: "suspended", issued: state.issued, holds: [...holds, TOGGLE_HOLD] }
  }

  const hold = event.type === "resume" ? event.hold : TOGGLE_HOLD

  if (!holds.includes(hold)) return state
  const rest = holds.filter((id) => id !== hold)

  if (rest.length === 0) return { status: "active", issued: state.issued }

  return { status: "suspended", issued: state.issued, holds: rest }
}

export function selectKeybindsSuspended(state: KeybindSuspendState) {
  return state.status === "suspended"
}
