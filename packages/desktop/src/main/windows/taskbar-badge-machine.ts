export type TaskbarBadgeState =
  | { readonly status: "blank" }
  | { readonly status: "showing"; readonly count: number; readonly description: string }

export type TaskbarBadgeEvent =
  | { readonly type: "badge.reported"; readonly count: number; readonly description: string }
  | { readonly type: "window.closed" }

export type TaskbarBadgeCommand =
  | { readonly type: "set"; readonly count: number; readonly description: string }
  | { readonly type: "clear" }

export type TaskbarBadgeTransition = {
  readonly state: TaskbarBadgeState
  readonly commands: readonly TaskbarBadgeCommand[]
}

export const INITIAL_TASKBAR_BADGE_STATE: TaskbarBadgeState = Object.freeze({ status: "blank" })

/** Caps rendered glyph count at 10 ("9+"). */
export function selectTaskbarBadgeGlyph(count: number) {
  return Math.min(Math.max(0, Math.floor(count)), 10)
}

export function transitionTaskbarBadge(state: TaskbarBadgeState, event: TaskbarBadgeEvent): TaskbarBadgeTransition {
  if (event.type === "window.closed") {
    return state.status === "blank"
      ? { state, commands: [] }
      : { state: INITIAL_TASKBAR_BADGE_STATE, commands: [] }
  }

  const count = Math.max(0, Math.floor(event.count))
  const description = count > 0 ? event.description : ""

  // A fresh idle window never touches ITaskbarList3 until a session needs attention.
  if (state.status === "blank") {
    if (count === 0) return { state, commands: [] }

    return {
      state: { status: "showing", count, description },
      commands: [{ type: "set", count, description }],
    }
  }

  if (count === 0) {
    return {
      state: INITIAL_TASKBAR_BADGE_STATE,
      commands: [{ type: "clear" }],
    }
  }

  if (state.count === count && state.description === description) return { state, commands: [] }

  return {
    state: { status: "showing", count, description },
    commands: [{ type: "set", count, description }],
  }
}
