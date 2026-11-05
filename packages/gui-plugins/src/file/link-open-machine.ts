import type { LineRange } from "@opencode/plugin/gui"

/** How long one link click may resolve and load before it gives up with an error. */
export const LINK_OPEN_TIMEOUT_MS = 30_000

/** What a clicked link names once resolved. */
export type LinkResolution =
  /** The link resolves to no path. */
  | { readonly kind: "missing" }
  /** Several workspace files end with the link's path. */
  | { readonly kind: "picker"; readonly query: string }
  /** An HTML file the browser pane can load. */
  | { readonly kind: "browser"; readonly url: string }
  | { readonly kind: "file"; readonly path: string; readonly selection?: LineRange }

/**
 * The window's latest link click. Each click takes the next attempt number, so a result whose attempt the state no
 * longer holds is stale; `issued` is the last one handed out.
 */
export type LinkOpenState =
  | { readonly status: "idle"; readonly issued: number }
  | {
      readonly status: "resolving"
      readonly attempt: number
      readonly sessionKey: string
      readonly root: string
      readonly href: string
      readonly background: boolean
    }
  | {
      readonly status: "loading"
      readonly attempt: number
      readonly sessionKey: string
      readonly root: string
      readonly background: boolean
      readonly path: string
      readonly selection?: LineRange
    }
  | { readonly status: "disposed" }

/** Where the user is when a result arrives: the routed session, its workspace root and whether the screen is the click's. */
export type LinkRoute = {
  readonly sessionKey?: string
  readonly root?: string
  readonly sameScreen: boolean
}

export type LinkOpenEvent =
  /** A known workspace file (the palette, a file comment) opens at once. `path` is empty when it resolves to none. */
  | {
      readonly type: "link.exact"
      readonly href: string
      readonly path: string
      readonly background: boolean
    }
  | {
      readonly type: "link.clicked"
      readonly sessionKey: string
      readonly root: string
      readonly href: string
      readonly base?: string
      readonly background: boolean
    }
  | {
      readonly type: "link.resolved"
      readonly attempt: number
      readonly route: LinkRoute
      readonly resolution: LinkResolution
    }
  /** The forced reread settled; the fields are the file's state after it. `opened` means the strip lists its tab. */
  | {
      readonly type: "file.synced"
      readonly attempt: number
      readonly route: LinkRoute
      readonly loaded: boolean
      readonly notFound: boolean
      readonly opened: boolean
      readonly error?: string
    }
  /** Resolving or loading rejected. */
  | { readonly type: "link.failed"; readonly attempt: number; readonly route: LinkRoute; readonly error: string }
  /** The click's work was aborted, or its screen went away. */
  | { readonly type: "link.cancelled"; readonly attempt: number }
  | { readonly type: "link.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type LinkOpenEffect =
  /** Starts the attempt's controller and timeout, then resolves the link. */
  | {
      readonly type: "resolve"
      readonly attempt: number
      readonly href: string
      readonly base?: string
      readonly background: boolean
      readonly timeoutMs: number
    }
  /** Rereads the file, without the file model's own toast: this machine reports the outcome. */
  | { readonly type: "sync"; readonly attempt: number; readonly path: string }
  /** Ends the attempt's controller and timeout. */
  | { readonly type: "abort"; readonly attempt: number }
  | { readonly type: "open-exact"; readonly path: string; readonly background: boolean }
  | {
      readonly type: "open-file"
      readonly path: string
      readonly selection?: LineRange
      readonly background: boolean
    }
  | { readonly type: "open-picker"; readonly query: string; readonly background: boolean }
  | { readonly type: "open-browser"; readonly url: string }
  | { readonly type: "toast-failed"; readonly path: string; readonly error?: string }
  | { readonly type: "toast-timeout"; readonly path: string }

export type LinkOpenTransition = { readonly state: LinkOpenState; readonly effects: readonly LinkOpenEffect[] }

// A fresh object, never a shared constant: the renderer keeps this state in a Solid store, which writes into the
// objects it holds.
export function createLinkOpenState(): LinkOpenState {
  return { status: "idle", issued: 0 }
}

const NONE: readonly LinkOpenEffect[] = []

type Active = Extract<LinkOpenState, { status: "resolving" | "loading" }>

export function transitionLinkOpen(state: LinkOpenState, event: LinkOpenEvent): LinkOpenTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: abortActive(state) }

  if (event.type === "link.exact")
    return {
      state: { status: "idle", issued: lastAttempt(state) + 1 },
      effects: [
        ...abortActive(state),
        event.path
          ? { type: "open-exact", path: event.path, background: event.background }
          : { type: "toast-failed", path: event.href },
      ],
    }

  if (event.type === "link.clicked") {
    const attempt = lastAttempt(state) + 1

    return {
      state: {
        status: "resolving",
        attempt,
        sessionKey: event.sessionKey,
        root: event.root,
        href: event.href,
        background: event.background,
      },
      effects: [
        ...abortActive(state),
        {
          type: "resolve",
          attempt,
          href: event.href,
          base: event.base,
          background: event.background,
          timeoutMs: LINK_OPEN_TIMEOUT_MS,
        },
      ],
    }
  }

  if (state.status === "idle" || event.attempt !== state.attempt) return { state, effects: NONE }

  if (event.type === "link.cancelled") return finish(state, NONE)

  if (event.type === "link.timed-out") return finish(state, [{ type: "toast-timeout", path: target(state) }])

  // The user moved to another session, screen or workspace directory: the result belongs to a place they left.
  if (!sameRoute(state, event.route)) return finish(state, NONE)

  if (event.type === "link.failed")
    return finish(state, [{ type: "toast-failed", path: target(state), error: event.error }])

  if (event.type === "link.resolved") {
    if (state.status !== "resolving") return { state, effects: NONE }

    return resolved(state, event.resolution)
  }

  if (state.status !== "loading") return { state, effects: NONE }

  const open: LinkOpenEffect = {
    type: "open-file",
    path: state.path,
    selection: state.selection,
    background: state.background,
  }

  // A reread of a loaded file that failed keeps the old content, so the tab opens and the error shows beside it.
  if (event.loaded)
    return finish(state, event.error ? [open, { type: "toast-failed", path: state.path, error: event.error }] : [open])

  // A strip tab for a deleted file shows the not-found state itself, so the link selects it.
  if (event.notFound && event.opened) return finish(state, [open])

  return finish(state, [{ type: "toast-failed", path: state.path, error: event.error }])
}

function resolved(state: Extract<LinkOpenState, { status: "resolving" }>, resolution: LinkResolution) {
  if (resolution.kind === "missing") return finish(state, [{ type: "toast-failed", path: state.href }])

  if (resolution.kind === "picker")
    return finish(state, [{ type: "open-picker", query: resolution.query, background: state.background }])

  if (resolution.kind === "browser") return finish(state, [{ type: "open-browser", url: resolution.url }])

  return {
    state: {
      status: "loading",
      attempt: state.attempt,
      sessionKey: state.sessionKey,
      root: state.root,
      background: state.background,
      path: resolution.path,
      selection: resolution.selection,
    },
    effects: [{ type: "sync", attempt: state.attempt, path: resolution.path }],
  } satisfies LinkOpenTransition
}

function finish(state: Active, effects: readonly LinkOpenEffect[]): LinkOpenTransition {
  return {
    state: { status: "idle", issued: state.attempt },
    effects: [{ type: "abort", attempt: state.attempt }, ...effects],
  }
}

function abortActive(state: Exclude<LinkOpenState, { status: "disposed" }>): readonly LinkOpenEffect[] {
  return state.status === "idle" ? NONE : [{ type: "abort", attempt: state.attempt }]
}

function lastAttempt(state: Exclude<LinkOpenState, { status: "disposed" }>) {
  return state.status === "idle" ? state.issued : state.attempt
}

function target(state: Active) {
  return state.status === "loading" ? state.path : state.href
}

function sameRoute(state: Active, route: LinkRoute) {
  return route.sameScreen && route.sessionKey === state.sessionKey && route.root === state.root
}
