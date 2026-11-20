import { createSignal, getOwner, onCleanup, untrack } from "solid-js"
import type { ComposerQuoteAnchor } from "@opencode/plugin/gui"
import type { QuoteSource } from "./quote-source"

/**
 * The quote whose comment editor is open, and its send.
 * - `closed`: no editor is open.
 * - `open`: the editor shows `key`; `draft` stays `undefined` until the user edits, so the saved comment shows.
 * - `sending`: a direct send of `draft` is in flight; the editor stays open and ignores chip toggles and edits.
 *   It ends only when the composer's submit settles, which the request layer bounds. A timeout of its own would
 *   report a failure while the composer still sends, and a retry then could post the quote twice.
 * - `failed`: the send did not go through; the editor keeps the draft and shows an alert until the next edit.
 * - `disposed`: the composer state was evicted; late results are ignored.
 */
export type QuoteCommentState =
  | { readonly status: "closed"; readonly issued: number }
  | {
      readonly status: "open"
      readonly issued: number
      readonly key: string
      readonly draft: string | undefined
      readonly anchor: ComposerQuoteAnchor | undefined
    }
  | {
      readonly status: "sending"
      readonly issued: number
      readonly attempt: number
      readonly key: string
      readonly draft: string
      readonly anchor: ComposerQuoteAnchor | undefined
    }
  | {
      readonly status: "failed"
      readonly issued: number
      readonly key: string
      readonly draft: string
      readonly anchor: ComposerQuoteAnchor | undefined
    }
  | { readonly status: "disposed" }

export type QuoteCommentEvent =
  | { readonly type: "opened"; readonly key: string; readonly anchor?: ComposerQuoteAnchor }
  | { readonly type: "closed" }
  | { readonly type: "draft.changed"; readonly draft: string }
  | { readonly type: "send.requested"; readonly draft: string }
  | { readonly type: "send.settled"; readonly attempt: number; readonly sent: boolean }
  /** The context items still in the draft; an editor whose quote is gone closes. */
  | { readonly type: "retained"; readonly keys: readonly string[] }
  | { readonly type: "disposed" }

export type QuoteCommentEffect = {
  readonly type: "send.run"
  readonly attempt: number
  readonly key: string
  readonly draft: string
}

export type QuoteCommentTransition = {
  readonly state: QuoteCommentState
  readonly effects: readonly QuoteCommentEffect[]
}

export type QuoteCommentView = {
  readonly draft: string
  readonly sending: boolean
  readonly failed: boolean
  /** A pointer down outside closes the editor only when nothing would be lost. */
  readonly canDismissOutside: boolean
}

export const INITIAL_QUOTE_COMMENT_STATE: QuoteCommentState = Object.freeze({ status: "closed", issued: 0 })

const NO_EFFECTS: readonly QuoteCommentEffect[] = Object.freeze([])

export function transitionQuoteComment(state: QuoteCommentState, event: QuoteCommentEvent): QuoteCommentTransition {
  if (state.status === "disposed") return stay(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: NO_EFFECTS }

  if (event.type === "retained") {
    if (state.status === "closed" || event.keys.includes(state.key)) return stay(state)

    return { state: { status: "closed", issued: state.issued }, effects: NO_EFFECTS }
  }

  if (state.status === "sending") {
    if (event.type !== "send.settled" || event.attempt !== state.attempt) return stay(state)

    if (event.sent) return { state: { status: "closed", issued: state.issued }, effects: NO_EFFECTS }

    return {
      state: { status: "failed", issued: state.issued, key: state.key, draft: state.draft, anchor: state.anchor },
      effects: NO_EFFECTS,
    }
  }

  if (event.type === "opened") {
    if (state.status !== "closed" && state.key === event.key) {
      if (state.anchor === event.anchor) return stay(state)

      return { state: { ...state, anchor: event.anchor }, effects: NO_EFFECTS }
    }

    return {
      state: { status: "open", issued: state.issued, key: event.key, draft: undefined, anchor: event.anchor },
      effects: NO_EFFECTS,
    }
  }

  if (state.status === "closed") return stay(state)

  if (event.type === "closed") return { state: { status: "closed", issued: state.issued }, effects: NO_EFFECTS }

  if (event.type === "draft.changed") {
    if (state.status === "open" && state.draft === event.draft) return stay(state)

    return {
      state: { status: "open", issued: state.issued, key: state.key, draft: event.draft, anchor: state.anchor },
      effects: NO_EFFECTS,
    }
  }

  if (event.type === "send.requested") {
    const attempt = state.issued + 1

    return {
      state: { status: "sending", issued: attempt, attempt, key: state.key, draft: event.draft, anchor: state.anchor },
      effects: [{ type: "send.run", attempt, key: state.key, draft: event.draft }],
    }
  }

  return stay(state)
}

/** The quote whose editor is open, or `undefined`. */
export function selectQuoteCommentKey(state: QuoteCommentState) {
  return state.status === "closed" || state.status === "disposed" ? undefined : state.key
}

export function selectQuoteCommentAnchor(state: QuoteCommentState) {
  return state.status === "closed" || state.status === "disposed" ? undefined : state.anchor
}

/** The quote whose timeline source stays highlighted: the open editor's, when it has a source. */
export function selectQuoteHighlightKey(
  key: string | undefined,
  sources: Readonly<Record<string, QuoteSource | undefined>>,
) {
  return key && sources[key]?.length ? key : undefined
}

export function selectQuoteCommentView(state: QuoteCommentState, key: string, saved: string): QuoteCommentView {
  const current = state.status !== "closed" && state.status !== "disposed" && state.key === key ? state : undefined
  const draft = current?.draft ?? saved
  const sending = current?.status === "sending"

  return {
    draft,
    sending,
    failed: current?.status === "failed",
    canDismissOutside: !sending && draft.trim() === saved.trim(),
  }
}

export type QuoteCommentController = ReturnType<typeof createQuoteCommentController>

export function createQuoteCommentController() {
  const [state, setState] = createSignal(INITIAL_QUOTE_COMMENT_STATE)
  // Handed from `send` to the `send.run` effect it causes in the same dispatch.
  let submit: ((key: string, comment: string) => Promise<boolean>) | undefined

  const dispatch = (event: QuoteCommentEvent) => {
    const previous = untrack(state)
    const next = transitionQuoteComment(previous, event)

    if (next.state !== previous) setState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: QuoteCommentEffect) => {
    const send = submit
    submit = undefined

    if (!send) return dispatch({ type: "send.settled", attempt: effect.attempt, sent: false })
    void Promise.try(() => send(effect.key, effect.draft)).then(
      (sent) => dispatch({ type: "send.settled", attempt: effect.attempt, sent }),
      () => dispatch({ type: "send.settled", attempt: effect.attempt, sent: false }),
    )
  }

  if (getOwner()) onCleanup(() => dispatch({ type: "disposed" }))

  return {
    state,
    key: () => selectQuoteCommentKey(state()),
    anchor: () => selectQuoteCommentAnchor(state()),
    set: (key?: string, anchor?: ComposerQuoteAnchor) =>
      dispatch(key ? { type: "opened", key, anchor } : { type: "closed" }),
    retain: (keys: readonly string[]) => dispatch({ type: "retained", keys }),
    setDraft: (draft: string) => dispatch({ type: "draft.changed", draft }),
    send: (draft: string, send: (key: string, comment: string) => Promise<boolean>) => {
      submit = send
      dispatch({ type: "send.requested", draft })
      submit = undefined
    },
  }
}

function stay(state: QuoteCommentState): QuoteCommentTransition {
  return { state, effects: NO_EFFECTS }
}
