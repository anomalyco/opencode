// The site information popover's cookie count and clear. Each read and clear takes the next attempt number, so an
// answer whose attempt the state no longer holds is stale.

/** A read that has not answered by then fails, so the popover offers a retry rather than an endless blank. */
export const SITE_LOAD_TIMEOUT_MS = 5_000

/** Main waits up to 30 s for the page to reload after a clear; past this the clear counts as failed. */
export const SITE_CLEAR_TIMEOUT_MS = 35_000

export type SiteState =
  /** `attempt` is the last one handed out. */
  | { readonly status: "closed"; readonly attempt: number }
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "ready"; readonly attempt: number; readonly cookies: number }
  | { readonly status: "failed"; readonly attempt: number }
  /** A clear outlives the popover closing, so a reopen waits for it and its failure still reports. */
  | { readonly status: "clearing"; readonly attempt: number; readonly open: boolean }
  | { readonly status: "disposed" }

export type SiteEvent =
  | { readonly type: "open.changed"; readonly open: boolean }
  | { readonly type: "retry" }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly cookies: number }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "clear.clicked" }
  | { readonly type: "clear.succeeded"; readonly attempt: number }
  | { readonly type: "clear.failed"; readonly attempt: number }
  | { readonly type: "timeout"; readonly phase: "loading" | "clearing"; readonly attempt: number }
  /** The popover unmounted: another tab or URL took its place, or the pane closed. */
  | { readonly type: "disposed" }

export type SiteEffect =
  | { readonly type: "load"; readonly attempt: number }
  | { readonly type: "clear"; readonly attempt: number }
  | { readonly type: "notify-clear-failed" }

export type SiteTransition = { readonly state: SiteState; readonly effects: readonly SiteEffect[] }

export const initialSiteState: SiteState = { status: "closed", attempt: 0 }

const DISPOSED: SiteState = { status: "disposed" }

const NOTIFY: SiteEffect = { type: "notify-clear-failed" }

export function transitionSite(state: SiteState, event: SiteEvent): SiteTransition {
  if (state.status === "disposed") return unchanged(state)

  switch (event.type) {
    case "disposed":
      return { state: DISPOSED, effects: [] }
    case "open.changed":
      return event.open ? opened(state) : closed(state)
    case "retry":
      return state.status === "failed" ? load(state.attempt + 1) : unchanged(state)
    case "load.succeeded":
      if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)

      return { state: { status: "ready", attempt: state.attempt, cookies: event.cookies }, effects: [] }
    case "load.failed":
      if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)

      return { state: { status: "failed", attempt: state.attempt }, effects: [] }
    case "clear.clicked":
      if (state.status !== "ready") return unchanged(state)

      return {
        state: { status: "clearing", attempt: state.attempt + 1, open: true },
        effects: [{ type: "clear", attempt: state.attempt + 1 }],
      }
    case "clear.succeeded":
      return cleared(state, event.attempt, [])
    case "clear.failed":
      return cleared(state, event.attempt, [NOTIFY])
    case "timeout":
      if (event.phase === "clearing") return cleared(state, event.attempt, [NOTIFY])

      if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)

      return { state: { status: "failed", attempt: state.attempt }, effects: [] }
  }
}

/** What the popover shows. */
export function siteView(state: SiteState) {
  return {
    open:
      state.status === "loading" ||
      state.status === "ready" ||
      state.status === "failed" ||
      (state.status === "clearing" && state.open),
    /** Undefined while reading or clearing, so a count from before a clear never shows. */
    cookies: state.status === "ready" ? state.cookies : undefined,
    /** The read failed: the cookie row says so, and its button reads again instead of clearing. */
    failed: state.status === "failed",
    actionDisabled: state.status !== "ready" && state.status !== "failed",
  }
}

function opened(state: Exclude<SiteState, { status: "disposed" }>): SiteTransition {
  if (state.status === "loading") return unchanged(state)

  if (state.status === "clearing")
    return state.open ? unchanged(state) : { state: { ...state, open: true }, effects: [] }

  return load(state.attempt + 1)
}

function closed(state: Exclude<SiteState, { status: "disposed" }>): SiteTransition {
  if (state.status === "closed") return unchanged(state)

  if (state.status === "clearing")
    return state.open ? { state: { ...state, open: false }, effects: [] } : unchanged(state)

  return { state: { status: "closed", attempt: state.attempt }, effects: [] }
}

/** A clear that settled reads the count again while the popover is open; a failure also tells the user. */
function cleared(state: SiteState, attempt: number, effects: readonly SiteEffect[]): SiteTransition {
  if (state.status !== "clearing" || attempt !== state.attempt) return unchanged(state)

  if (!state.open) return { state: { status: "closed", attempt: state.attempt }, effects }
  const next = load(state.attempt + 1)

  return { state: next.state, effects: [...effects, ...next.effects] }
}

function load(attempt: number): SiteTransition {
  return { state: { status: "loading", attempt }, effects: [{ type: "load", attempt }] }
}

function unchanged(state: SiteState): SiteTransition {
  return { state, effects: [] }
}
