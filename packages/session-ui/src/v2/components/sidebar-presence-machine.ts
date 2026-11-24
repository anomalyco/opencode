/** The CSS slide's 200ms, plus slack, after which a close lands even when no `transitionend` arrives. */
export const SIDEBAR_EXIT_TIMEOUT_MS = 300

/**
 * The review and file tree sidebar. It mounts while open and slides its width on the user's toggles; a close keeps it
 * mounted until the slide ends, then unmounts it, so no hidden tree is left behind.
 */
export type SidebarPresenceState =
  | { readonly status: "open"; readonly attempt: number }
  /** Opened by a toggle, so it slides in from zero width when it mounts. */
  | { readonly status: "opening"; readonly attempt: number }
  | { readonly status: "closing"; readonly attempt: number }
  | { readonly status: "closed"; readonly attempt: number }

export type SidebarPresenceEvent =
  /** `animate` is false while the preference hydrates and under reduced motion. */
  | { readonly type: "open.changed"; readonly open: boolean; readonly animate: boolean }
  | { readonly type: "exit.ended" }
  | { readonly type: "exit.timed-out"; readonly attempt: number }

export type SidebarPresenceEffect = { readonly type: "exit.timer"; readonly attempt: number }

export type SidebarPresenceTransition = {
  readonly state: SidebarPresenceState
  readonly effects: readonly SidebarPresenceEffect[]
}

const NO_EFFECTS: readonly SidebarPresenceEffect[] = []

export function createSidebarPresenceState(open: boolean): SidebarPresenceState {
  return { status: open ? "open" : "closed", attempt: 0 }
}

export function transitionSidebarPresence(
  state: SidebarPresenceState,
  event: SidebarPresenceEvent,
): SidebarPresenceTransition {
  if (event.type === "exit.ended") {
    if (state.status !== "closing") return { state, effects: NO_EFFECTS }

    return { state: { status: "closed", attempt: state.attempt }, effects: NO_EFFECTS }
  }

  if (event.type === "exit.timed-out") {
    if (state.status !== "closing" || state.attempt !== event.attempt) return { state, effects: NO_EFFECTS }

    return { state: { status: "closed", attempt: state.attempt }, effects: NO_EFFECTS }
  }

  if (event.open) {
    if (state.status === "open" || state.status === "opening") return { state, effects: NO_EFFECTS }

    // Reopening mid-close keeps the mounted sidebar, so its width turns around from where it is.
    if (state.status === "closing") return { state: { status: "open", attempt: state.attempt }, effects: NO_EFFECTS }

    return { state: { status: event.animate ? "opening" : "open", attempt: state.attempt }, effects: NO_EFFECTS }
  }

  if (state.status === "closed" || state.status === "closing") return { state, effects: NO_EFFECTS }

  if (!event.animate) return { state: { status: "closed", attempt: state.attempt }, effects: NO_EFFECTS }

  const attempt = state.attempt + 1

  return { state: { status: "closing", attempt }, effects: [{ type: "exit.timer", attempt }] }
}

/** The sidebar is in the page: open, sliding in, or sliding out. */
export const selectSidebarMounted = (state: SidebarPresenceState) => state.status !== "closed"
