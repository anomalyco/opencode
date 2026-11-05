import type { PromptAttachment } from "@opencode/client/promise"

/** A media read that never settles shows the failed tile after this long, as file and markdown images do. */
export const ATTACHMENT_MEDIA_TIMEOUT_MS = 15_000

/**
 * What an attachment slot shows, read from its current attachment: nothing (not an image), a URL already in hand, a
 * `media:` reference nothing here can read, or a reference the host reads.
 */
export type AttachmentMediaTarget =
  | { readonly kind: "none" }
  | { readonly kind: "direct"; readonly src: string }
  | { readonly kind: "unreadable" }
  | { readonly kind: "remote"; readonly key: string; readonly uri: string; readonly mime: string }

/** The host read of one `remote` target. `attempt` lets only the latest read and its own timeout settle it. */
export type AttachmentMediaState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "loading"; readonly attempt: number; readonly key: string }
  | { readonly status: "ready"; readonly attempt: number; readonly key: string; readonly src: string }
  | { readonly status: "failed"; readonly attempt: number; readonly key: string }
  | { readonly status: "disposed" }

export type AttachmentMediaEvent =
  | { readonly type: "target.synced"; readonly target: AttachmentMediaTarget }
  | { readonly type: "retry.requested"; readonly target: AttachmentMediaTarget }
  | { readonly type: "read.succeeded"; readonly attempt: number; readonly src: string }
  | { readonly type: "read.failed"; readonly attempt: number }
  | { readonly type: "read.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type AttachmentMediaEffect =
  | {
      readonly type: "read"
      readonly attempt: number
      readonly uri: string
      readonly mime: string
      readonly timeoutMs: number
    }
  /** Aborts the read in flight and clears its timer. */
  | { readonly type: "cancel" }

export type AttachmentMediaTransition = {
  readonly state: AttachmentMediaState
  readonly effects: readonly AttachmentMediaEffect[]
}

export type AttachmentMediaView = {
  readonly status: "idle" | "loading" | "ready" | "failed"
  readonly src: string | undefined
  readonly placeholder: boolean
  readonly clickable: boolean
  readonly canRetry: boolean
}

export const NONE_ATTACHMENT_MEDIA_TARGET: AttachmentMediaTarget = Object.freeze({ kind: "none" })

export const UNREADABLE_ATTACHMENT_MEDIA_TARGET: AttachmentMediaTarget = Object.freeze({ kind: "unreadable" })

export const INITIAL_ATTACHMENT_MEDIA_STATE: AttachmentMediaState = Object.freeze({ status: "idle", attempt: 0 })

export const DISPOSED_ATTACHMENT_MEDIA_STATE: AttachmentMediaState = Object.freeze({ status: "disposed" })

export const DISPOSED_ATTACHMENT_MEDIA_EVENT: AttachmentMediaEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly AttachmentMediaEffect[] = Object.freeze([])

const CANCEL_EFFECT: AttachmentMediaEffect = Object.freeze({ type: "cancel" })

const CANCEL: readonly AttachmentMediaEffect[] = Object.freeze([CANCEL_EFFECT])

export function resolveAttachmentMediaTarget(
  file: PromptAttachment,
  options: { readonly peekMedia?: (uri: string, mime: string) => string | undefined; readonly hasReader: boolean },
): AttachmentMediaTarget {
  if (!file.mime.startsWith("image/")) return NONE_ATTACHMENT_MEDIA_TARGET

  if (file.source?.type === "uri") return { kind: "direct", src: file.source.uri }

  if ("data" in file && file.data !== undefined) return { kind: "direct", src: `data:${file.mime};base64,${file.data}` }

  const uri = "uri" in file ? file.uri : undefined

  if (!uri) return UNREADABLE_ATTACHMENT_MEDIA_TARGET

  const peeked = options.peekMedia?.(uri, file.mime)

  if (peeked !== undefined) return { kind: "direct", src: peeked }

  if (options.hasReader) return { kind: "remote", key: `${file.mime}:${uri}`, uri, mime: file.mime }

  // Without a reader a `media:` reference names no loadable URL; anything else is one.
  if (uri.startsWith("media:")) return UNREADABLE_ATTACHMENT_MEDIA_TARGET

  return { kind: "direct", src: uri }
}

export function transitionAttachmentMedia(
  state: AttachmentMediaState,
  event: AttachmentMediaEvent,
): AttachmentMediaTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") {
    return { state: DISPOSED_ATTACHMENT_MEDIA_STATE, effects: state.status === "loading" ? CANCEL : NO_EFFECTS }
  }

  if (event.type === "target.synced") return sync(state, event.target)

  if (event.type === "retry.requested") {
    if (state.status !== "failed" || event.target.kind !== "remote" || event.target.key !== state.key) {
      return { state, effects: NO_EFFECTS }
    }

    return read(state, event.target)
  }

  if (state.status !== "loading" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (event.type === "read.succeeded" && event.src.length > 0) {
    return { state: { status: "ready", attempt: state.attempt, key: state.key, src: event.src }, effects: CANCEL }
  }

  return { state: { status: "failed", attempt: state.attempt, key: state.key }, effects: CANCEL }
}

export function viewAttachmentMedia(state: AttachmentMediaState, target: AttachmentMediaTarget): AttachmentMediaView {
  if (target.kind === "none") return IDLE_VIEW

  if (target.kind === "direct") return { status: "ready", src: target.src, placeholder: false, clickable: true, canRetry: false }

  if (target.kind === "unreadable") return UNREADABLE_VIEW

  // Before the slot's effect syncs a new target, the state still describes the previous attachment: never show it.
  if (state.status === "idle" || state.status === "disposed" || state.key !== target.key) return LOADING_VIEW

  if (state.status === "loading") return LOADING_VIEW

  if (state.status === "failed") return FAILED_VIEW

  return { status: "ready", src: state.src, placeholder: false, clickable: true, canRetry: false }
}

const IDLE_VIEW: AttachmentMediaView = Object.freeze({
  status: "idle",
  src: undefined,
  placeholder: false,
  clickable: false,
  canRetry: false,
})

const LOADING_VIEW: AttachmentMediaView = Object.freeze({
  status: "loading",
  src: undefined,
  placeholder: true,
  clickable: false,
  canRetry: false,
})

const FAILED_VIEW: AttachmentMediaView = Object.freeze({
  status: "failed",
  src: undefined,
  placeholder: false,
  clickable: true,
  canRetry: true,
})

const UNREADABLE_VIEW: AttachmentMediaView = Object.freeze({
  status: "failed",
  src: undefined,
  placeholder: false,
  clickable: false,
  canRetry: false,
})

function sync(
  state: Exclude<AttachmentMediaState, { status: "disposed" }>,
  target: AttachmentMediaTarget,
): AttachmentMediaTransition {
  if (target.kind === "remote") {
    if (state.status !== "idle" && state.key === target.key) return { state, effects: NO_EFFECTS }

    return read(state, target)
  }

  if (state.status === "idle") return { state, effects: NO_EFFECTS }

  return {
    state: { status: "idle", attempt: state.attempt },
    effects: state.status === "loading" ? CANCEL : NO_EFFECTS,
  }
}

function read(
  state: Exclude<AttachmentMediaState, { status: "disposed" }>,
  target: Extract<AttachmentMediaTarget, { kind: "remote" }>,
): AttachmentMediaTransition {
  const attempt = state.attempt + 1
  const effect: AttachmentMediaEffect = {
    type: "read",
    attempt,
    uri: target.uri,
    mime: target.mime,
    timeoutMs: ATTACHMENT_MEDIA_TIMEOUT_MS,
  }

  return {
    state: { status: "loading", attempt, key: target.key },
    effects: state.status === "loading" ? [CANCEL_EFFECT, effect] : [effect],
  }
}
