import type { OpenOptions } from "@opencode/plugin/gui"

/** A narrow-screen view selected for a session that is not routed waits this long for the navigation that routes it. */
export const MOBILE_VIEW_PENDING_TTL_MS = 5_000

/** An open-project request waits this long for its server to be listed (e.g. an SSH server connecting). */
export const PROJECT_REQUEST_TTL_MS = 30_000

/** Who an open side region belongs to: the panel whose toggle opened it, or the user. */
export type OpenSideRegion = { readonly status: "open-for-panel"; readonly key: string } | { readonly status: "open-user" }

export type SideRegionSessionState = { readonly status: "closed" } | OpenSideRegion

/** Each session's open side region, by session key; a session that is absent has its side region closed. */
export type SideRegionState = ReadonlyMap<string, OpenSideRegion>

export type SideRegionEvent =
  /** The sessions whose side region is open now, read from the shell tabs. */
  | { readonly type: "sync"; readonly opened: ReadonlySet<string> }
  | {
      readonly type: "panel.opened"
      readonly session: string
      readonly key: string
      readonly via: "open" | "toggle"
      readonly placement: NonNullable<OpenOptions["tab"]>
      readonly wasOpen: boolean
      readonly nowOpen: boolean
    }
  /** `Layout.toggle` closed a visible panel; `empty` when the session's strip has no stored tab left. */
  | { readonly type: "panel.closed"; readonly session: string; readonly key: string; readonly empty: boolean }

export type SideRegionEffect = { readonly type: "close.side"; readonly session: string }

export type SideRegionTransition = { readonly state: SideRegionState; readonly effects: readonly SideRegionEffect[] }

export function createSideRegionState(): SideRegionState {
  return new Map()
}

export function transitionSideRegion(state: SideRegionState, event: SideRegionEvent): SideRegionTransition {
  if (event.type === "sync") {
    if (state.size === event.opened.size && Array.from(event.opened).every((key) => state.has(key)))
      return { state, effects: [] }

    // A region that closed, however it closed, forgets its panel; one opened any other way is the user's.
    return {
      state: new Map(Array.from(event.opened, (key) => [key, state.get(key) ?? { status: "open-user" }] as const)),
      effects: [],
    }
  }

  const current = state.get(event.session)

  if (event.type === "panel.closed") {
    if (!event.empty || current?.status !== "open-for-panel" || current.key !== event.key) return { state, effects: [] }

    // Closing the last panel the region was opened for also closes the region.
    return { state: without(state, event.session), effects: [{ type: "close.side", session: event.session }] }
  }

  if (!event.nowOpen) return { state: current ? without(state, event.session) : state, effects: [] }

  if (!event.wasOpen)
    return {
      state: new Map(state).set(
        event.session,
        event.via === "toggle" ? { status: "open-for-panel", key: event.key } : { status: "open-user" },
      ),
      effects: [],
    }

  // A quiet append, or opening the panel the region belongs to, keeps it; any other panel opened into the open region
  // makes it the user's.
  if (current?.status === "open-user") return { state, effects: [] }

  if (
    current?.status === "open-for-panel" &&
    event.via === "open" &&
    (event.placement === "append" || current.key === event.key)
  )
    return { state, effects: [] }

  return { state: new Map(state).set(event.session, { status: "open-user" }), effects: [] }
}

export function selectSideRegionSession(state: SideRegionState, session: string): SideRegionSessionState {
  return state.get(session) ?? { status: "closed" }
}

function without(state: SideRegionState, session: string) {
  const next = new Map(state)
  next.delete(session)

  return next
}

/**
 * The narrow-screen view for one routing visit. `pending` is a view selected for a session that is not routed (e.g. a
 * file link that opens Files on another session): it belongs to the next visit only if that visit routes its session
 * within `MOBILE_VIEW_PENDING_TTL_MS`. `attempt` names the latest pending view, whose expiry alone applies.
 */
export type MobileViewState =
  | { readonly status: "conversation"; readonly attempt: number }
  | { readonly status: "active"; readonly attempt: number; readonly session: string; readonly view: string }
  | { readonly status: "pending"; readonly attempt: number; readonly session: string; readonly view: string }
  | { readonly status: "disposed" }

export type MobileViewEvent =
  | { readonly type: "select"; readonly session: string; readonly view: string; readonly routed: string | undefined }
  | { readonly type: "route.changed"; readonly routed: string | undefined }
  | { readonly type: "expire"; readonly attempt: number }
  | { readonly type: "disposed" }

export type MobileViewEffect =
  | { readonly type: "schedule.expire"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "cancel.expire" }

export type MobileViewTransition = { readonly state: MobileViewState; readonly effects: readonly MobileViewEffect[] }

export function createMobileViewState(): MobileViewState {
  return { status: "conversation", attempt: 0 }
}

export function transitionMobileView(state: MobileViewState, event: MobileViewEvent): MobileViewTransition {
  if (state.status === "disposed") return { state, effects: [] }
  const cancel: MobileViewEffect[] = state.status === "pending" ? [{ type: "cancel.expire" }] : []

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cancel }

  if (event.type === "select") {
    if (event.view === "session")
      return {
        state: state.status === "conversation" ? state : { status: "conversation", attempt: state.attempt },
        effects: cancel,
      }

    if (event.session === event.routed)
      return {
        state: { status: "active", attempt: state.attempt, session: event.session, view: event.view },
        effects: cancel,
      }
    const attempt = state.attempt + 1

    return {
      state: { status: "pending", attempt, session: event.session, view: event.view },
      effects: [...cancel, { type: "schedule.expire", attempt, timeoutMs: MOBILE_VIEW_PENDING_TTL_MS }],
    }
  }

  if (event.type === "expire") {
    if (state.status !== "pending" || event.attempt !== state.attempt) return { state, effects: [] }

    return { state: { status: "conversation", attempt: state.attempt }, effects: [] }
  }

  if (state.status === "conversation") return { state, effects: [] }

  if (state.status === "active" && event.routed === state.session) return { state, effects: [] }

  // The navigation that follows a pending view starts its visit; any other visit reads as the conversation.
  if (state.status === "pending" && event.routed === state.session)
    return {
      state: { status: "active", attempt: state.attempt, session: state.session, view: state.view },
      effects: cancel,
    }

  return { state: { status: "conversation", attempt: state.attempt }, effects: cancel }
}

/** The view the mounted session shows on a narrow screen; `"session"` is the conversation. */
export function selectMobileView(state: MobileViewState, mounted: string | undefined) {
  return state.status === "active" && state.session === mounted ? state.view : "session"
}

/** One open-project request; a newer request replaces one that still waits for its server. */
export type ProjectRequestState =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "waiting"
      readonly attempt: number
      readonly server: string
      readonly title: string
    }
  | { readonly status: "disposed" }

export type ProjectRequestEvent =
  | { readonly type: "request"; readonly server: string; readonly title: string; readonly listed: boolean }
  | { readonly type: "server.listed"; readonly server: string }
  | { readonly type: "expire"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ProjectRequestEffect =
  | { readonly type: "open.picker"; readonly server: string; readonly title: string }
  | { readonly type: "schedule.expire"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "cancel.expire" }

export type ProjectRequestTransition = {
  readonly state: ProjectRequestState
  readonly effects: readonly ProjectRequestEffect[]
}

export function createProjectRequestState(): ProjectRequestState {
  return { status: "idle", attempt: 0 }
}

export function transitionProjectRequest(
  state: ProjectRequestState,
  event: ProjectRequestEvent,
): ProjectRequestTransition {
  if (state.status === "disposed") return { state, effects: [] }
  const cancel: ProjectRequestEffect[] = state.status === "waiting" ? [{ type: "cancel.expire" }] : []

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cancel }

  if (event.type === "request") {
    if (event.listed)
      return {
        state: state.status === "idle" ? state : { status: "idle", attempt: state.attempt },
        effects: [...cancel, { type: "open.picker", server: event.server, title: event.title }],
      }
    const attempt = state.attempt + 1

    return {
      state: { status: "waiting", attempt, server: event.server, title: event.title },
      effects: [...cancel, { type: "schedule.expire", attempt, timeoutMs: PROJECT_REQUEST_TTL_MS }],
    }
  }

  if (state.status !== "waiting") return { state, effects: [] }

  if (event.type === "server.listed") {
    if (event.server !== state.server) return { state, effects: [] }

    return {
      state: { status: "idle", attempt: state.attempt },
      effects: [...cancel, { type: "open.picker", server: state.server, title: state.title }],
    }
  }

  if (event.attempt !== state.attempt) return { state, effects: [] }

  return { state: { status: "idle", attempt: state.attempt }, effects: [] }
}

/** The server a waiting request needs listed. */
export function selectWaitingProjectServer(state: ProjectRequestState) {
  return state.status === "waiting" ? state.server : undefined
}
