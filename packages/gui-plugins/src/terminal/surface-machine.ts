/** A terminal the panel keeps mounted. Each mount takes its own snapshot and socket. */
export type Surface = {
  readonly session: string
  readonly id: string
  /** Names this mount across the panel's lifetime; a remount takes the next one. */
  readonly mount: number
  /** The session's server connection when it mounted, from `sessionConnection` in `./machine`. */
  readonly connection: number
  /**
   * `live` while it has, or is opening, its socket. `failed` once the socket ended while it showed: it stays mounted
   * to say why. Like the TUI, a terminal doesn't reconnect by itself.
   */
  readonly status: "live" | "failed"
}

/**
 * The terminals the panel keeps mounted for the routed session. `issued` is the last mount handed out. `seeded` is the
 * session that last got its first terminal while the narrow-screen view showed, so each session in a row gets one.
 */
export type SurfaceState =
  | { readonly status: "idle"; readonly issued: number; readonly seeded: string | null }
  | {
      readonly status: "ready"
      readonly issued: number
      readonly session: string
      /** The server connection whose answer the session's list is. */
      readonly connection: number
      readonly opened: boolean
      /** The panel's selected terminal, shown while `opened`. */
      readonly active: string | null
      readonly seeded: string | null
      readonly surfaces: readonly Surface[]
    }

export type SurfaceEvent =
  /** The routed session, its list, or the panel changed. */
  | {
      readonly type: "sync"
      readonly session: string
      /** The server listed the session's terminals. */
      readonly ready: boolean
      readonly connection: number
      readonly opened: boolean
      /** The panel shows as the narrow-screen view, which has no strip to open terminals from. */
      readonly mobile: boolean
      readonly active: string | null
      readonly terminalIDs: readonly string[]
      /** Terminals whose tabs the user moved to another pane, which renders them. */
      readonly elsewhere: ReadonlySet<string>
    }
  /** A mounted terminal's socket ended. */
  | { readonly type: "surface.failed"; readonly mount: number }

/** Creates the session's first terminal. */
export type SurfaceEffect = { readonly type: "create-terminal" }

export type SurfaceTransition = { readonly state: SurfaceState; readonly effects: readonly SurfaceEffect[] }

export const initialSurfaceState: SurfaceState = { status: "idle", issued: 0, seeded: null }

const NONE: readonly Surface[] = []

const MOUNTS: readonly number[] = []

const QUIET: readonly SurfaceEffect[] = []

const CREATE: readonly SurfaceEffect[] = [{ type: "create-terminal" }]

/**
 * A terminal mounts, and connects, once it shows, and stays mounted while its session stays routed, so switching tabs
 * keeps its screen. A terminal whose socket ended stays to say why while it shows and leaves once it doesn't. One that
 * ended under an older server connection, such as across a server restart, mounts again once, after the newer
 * connection lists it.
 */
export function transitionSurface(state: SurfaceState, event: SurfaceEvent): SurfaceTransition {
  if (event.type === "surface.failed") return { state: failed(state, event.mount), effects: QUIET }

  return sync(state, event)
}

/** The mounts to render, in a stable order; a mount keeps its terminal while it goes from live to failed. */
export function surfaceMounts(state: SurfaceState) {
  return state.status === "ready" ? state.surfaces.map((surface) => surface.mount) : MOUNTS
}

export function surfaceAt(state: SurfaceState, mount: number) {
  return state.status === "ready" ? state.surfaces.find((surface) => surface.mount === mount) : undefined
}

export function surfaceShown(state: SurfaceState, surface: Surface) {
  return state.status === "ready" && state.session === surface.session && state.active === surface.id
}

function sync(state: SurfaceState, event: Extract<SurfaceEvent, { type: "sync" }>): SurfaceTransition {
  // The narrow-screen view seeds a session first seen empty once it lists; the side region opens terminals from its strip.
  const seeded = event.opened && event.mobile ? (event.ready ? event.session : state.seeded) : null

  const effects =
    event.opened && event.mobile && event.ready && state.seeded !== event.session && event.terminalIDs.length === 0
      ? CREATE
      : QUIET

  if (!event.ready) {
    if (state.status === "idle" && state.seeded === seeded) return { state, effects }

    return { state: { status: "idle", issued: state.issued, seeded }, effects }
  }

  const ids = new Set(event.terminalIDs)
  const here = (id: string) => ids.has(id) && !event.elsewhere.has(id)
  const shown = event.opened && event.active !== null && here(event.active) ? event.active : null
  const previous = state.status === "ready" && state.session === event.session ? state.surfaces : NONE

  const kept = previous.filter(
    (surface) =>
      here(surface.id) &&
      (surface.status === "live" || (surface.id === shown && event.connection <= surface.connection)),
  )

  const missing = shown !== null && !kept.some((surface) => surface.id === shown)
  const issued = missing ? state.issued + 1 : state.issued

  const surfaces = missing
    ? [...kept, mounted(event.session, shown, issued, event.connection)]
    : kept.length === previous.length
      ? previous
      : kept

  if (
    state.status === "ready" &&
    effects === QUIET &&
    state.session === event.session &&
    state.connection === event.connection &&
    state.opened === event.opened &&
    state.active === event.active &&
    state.seeded === seeded &&
    state.surfaces === surfaces
  )
    return { state, effects }

  return {
    state: {
      status: "ready",
      issued,
      session: event.session,
      connection: event.connection,
      opened: event.opened,
      active: event.active,
      seeded,
      surfaces,
    },
    effects,
  }
}

function failed(state: SurfaceState, mount: number): SurfaceState {
  if (state.status !== "ready") return state
  const current = state.surfaces.find((surface) => surface.mount === mount)

  // An earlier mount, or one already failed, says nothing new.
  if (!current || current.status === "failed") return state

  if (!state.opened || state.active !== current.id)
    return { ...state, surfaces: state.surfaces.filter((surface) => surface !== current) }

  // The server listed the session again since this mounted, so a socket from before a restart ended late.
  if (state.connection > current.connection) {
    const issued = state.issued + 1

    return {
      ...state,
      issued,
      surfaces: swap(state.surfaces, current, mounted(state.session, current.id, issued, state.connection)),
    }
  }

  return { ...state, surfaces: swap(state.surfaces, current, { ...current, status: "failed" }) }
}

function swap(surfaces: readonly Surface[], current: Surface, next: Surface) {
  return surfaces.map((surface) => (surface === current ? next : surface))
}

function mounted(session: string, id: string, mount: number, connection: number): Surface {
  return { session, id, mount, connection, status: "live" }
}
