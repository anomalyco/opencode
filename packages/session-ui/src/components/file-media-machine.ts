export const FILE_MEDIA_READ_TIMEOUT_MS = 15_000

export type RemoteMediaKind = "image" | "audio"

export type LoadedMedia = {
  readonly src: string
  readonly mime: string | undefined
}

export type RemoteMediaTarget = {
  readonly key: string
  readonly kind: RemoteMediaKind
  readonly path: string
}

/**
 * A remote image or audio read. `loading` carries the media a same-file refresh replaces, so a refresh that fails or
 * hangs keeps showing it; `attempt` lets only the latest read and its own timeout settle the load.
 */
export type FileMediaState =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "loading"
      readonly attempt: number
      readonly key: string
      readonly kind: RemoteMediaKind
      readonly previous: LoadedMedia | undefined
    }
  | {
      readonly status: "ready"
      readonly attempt: number
      readonly key: string
      readonly kind: RemoteMediaKind
      readonly media: LoadedMedia
    }
  | { readonly status: "failed"; readonly attempt: number; readonly key: string; readonly kind: RemoteMediaKind }
  | { readonly status: "disposed" }

export type FileMediaEvent =
  | { readonly type: "request.changed"; readonly target: RemoteMediaTarget | undefined }
  | { readonly type: "read.succeeded"; readonly attempt: number; readonly media: LoadedMedia }
  | { readonly type: "read.failed"; readonly attempt: number }
  | { readonly type: "read.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type FileMediaEffect =
  | { readonly type: "read-file"; readonly attempt: number; readonly kind: RemoteMediaKind; readonly path: string }
  | { readonly type: "arm-timeout"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "clear-timeout" }
  | { readonly type: "notify-error"; readonly kind: RemoteMediaKind }

export type FileMediaTransition = {
  readonly state: FileMediaState
  readonly effects: readonly FileMediaEffect[]
}

export const INITIAL_FILE_MEDIA_STATE: FileMediaState = Object.freeze({ status: "idle", attempt: 0 })

export const DISPOSED_FILE_MEDIA_STATE: FileMediaState = Object.freeze({ status: "disposed" })

export const DISPOSED_FILE_MEDIA_EVENT: FileMediaEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly FileMediaEffect[] = Object.freeze([])

const CLEAR_TIMEOUT: FileMediaEffect = Object.freeze({ type: "clear-timeout" })

const CLEAR_ONLY: readonly FileMediaEffect[] = Object.freeze([CLEAR_TIMEOUT])

export function transitionFileMedia(state: FileMediaState, event: FileMediaEvent): FileMediaTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return { state: DISPOSED_FILE_MEDIA_STATE, effects: state.status === "loading" ? CLEAR_ONLY : NO_EFFECTS }

  if (event.type === "request.changed") return request(state, event.target)

  if (state.status !== "loading" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (event.type === "read.succeeded")
    return {
      state: { status: "ready", attempt: state.attempt, key: state.key, kind: state.kind, media: event.media },
      effects: CLEAR_ONLY,
    }

  // The timer already fired, so only a failed read has one to clear.
  const clear = event.type === "read.failed" ? CLEAR_ONLY : NO_EFFECTS

  if (state.previous)
    return {
      state: { status: "ready", attempt: state.attempt, key: state.key, kind: state.kind, media: state.previous },
      effects: clear,
    }

  return {
    state: { status: "failed", attempt: state.attempt, key: state.key, kind: state.kind },
    effects: [...clear, { type: "notify-error", kind: state.kind }],
  }
}

function request(
  state: Exclude<FileMediaState, { status: "disposed" }>,
  target: RemoteMediaTarget | undefined,
): FileMediaTransition {
  if (!target) {
    if (state.status === "idle") return { state, effects: NO_EFFECTS }

    return {
      state: { status: "idle", attempt: state.attempt },
      effects: state.status === "loading" ? CLEAR_ONLY : NO_EFFECTS,
    }
  }

  const attempt = state.attempt + 1
  const previous = sameFileMedia(state, target.key)

  return {
    state: { status: "loading", attempt, key: target.key, kind: target.kind, previous },
    effects: [
      ...(state.status === "loading" ? CLEAR_ONLY : NO_EFFECTS),
      { type: "read-file", attempt, kind: target.kind, path: target.path },
      { type: "arm-timeout", attempt, delayMs: FILE_MEDIA_READ_TIMEOUT_MS },
    ],
  }
}

// A re-read of the same file (a VCS diff refresh) keeps what it already shows; another file starts blank.
function sameFileMedia(state: Exclude<FileMediaState, { status: "disposed" }>, key: string) {
  if (state.status === "ready" && state.key === key) return state.media

  if (state.status === "loading" && state.key === key) return state.previous
}

export type FileMediaView = {
  readonly status: "idle" | "loading" | "error" | "ready"
  readonly src: string | undefined
  readonly mime: string | undefined
}

const IDLE_VIEW: FileMediaView = Object.freeze({ status: "idle", src: undefined, mime: undefined })

const LOADING_VIEW: FileMediaView = Object.freeze({ status: "loading", src: undefined, mime: undefined })

const ERROR_VIEW: FileMediaView = Object.freeze({ status: "error", src: undefined, mime: undefined })

/** `direct` is media already in the props; `targetKey` is the read the current props ask for. */
export function viewFileMedia(
  state: FileMediaState,
  direct: string | undefined,
  targetKey: string | undefined,
): FileMediaView {
  if (direct) return { status: "ready", src: direct, mime: undefined }

  if (!targetKey) return IDLE_VIEW

  // Before the effect dispatches a new key, the state still describes the previous file: never show its media.
  if (state.status === "idle" || state.status === "disposed" || state.key !== targetKey) return LOADING_VIEW

  if (state.status === "failed") return ERROR_VIEW

  const media = state.status === "ready" ? state.media : state.previous

  if (!media) return LOADING_VIEW

  return { status: "ready", src: media.src, mime: media.mime }
}
