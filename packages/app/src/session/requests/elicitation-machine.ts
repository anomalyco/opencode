import type { FormAnswer, FormInfo, FormValue } from "@opencode/client/promise"

// A reply or dismissal that never settles gives the dock back after this long, so it cannot stay disabled forever.
export const ELICITATION_REQUEST_TIMEOUT_MS = 30_000

export type ElicitationField = FormInfo["fields"][number]

// Number inputs keep their raw text so a half-typed value such as "-" is not discarded.
export type ElicitationDraft = {
  readonly text: Readonly<Record<string, string>>
  readonly number: Readonly<Record<string, string>>
  readonly flag: Readonly<Record<string, boolean>>
  readonly list: Readonly<Record<string, readonly string[]>>
}

export type ElicitationAction = { readonly type: "reply"; readonly answer: FormAnswer } | { readonly type: "cancel" }

export type ElicitationDockState =
  | { readonly status: "answering"; readonly attempt: number; readonly draft: ElicitationDraft }
  | {
      readonly status: "sending"
      readonly attempt: number
      readonly draft: ElicitationDraft
      readonly action: ElicitationAction
    }
  | { readonly status: "replied"; readonly attempt: number; readonly draft: ElicitationDraft }
  // `unsent` is the draft of a reply still in flight when the dock went away, kept until the reply settles.
  | { readonly status: "disposed"; readonly attempt: number; readonly unsent: ElicitationDraft | undefined }

export type ElicitationDockEvent =
  | { readonly type: "text.set"; readonly key: string; readonly value: string }
  | { readonly type: "number.set"; readonly key: string; readonly value: string }
  | { readonly type: "flag.set"; readonly key: string; readonly value: boolean }
  | { readonly type: "list.toggle"; readonly key: string; readonly value: string; readonly checked: boolean }
  | { readonly type: "send"; readonly action: ElicitationAction }
  | { readonly type: "request.succeeded"; readonly attempt: number }
  | { readonly type: "request.failed"; readonly attempt: number; readonly error?: string }
  | { readonly type: "request.timed-out"; readonly attempt: number }
  // `form.replied` or `form.cancelled` arrived for this form.
  | { readonly type: "resolved" }
  | { readonly type: "disposed" }

export type ElicitationDockEffect =
  | { readonly type: "notify.submit" }
  | { readonly type: "cache.save"; readonly draft: ElicitationDraft }
  | { readonly type: "cache.delete" }
  | { readonly type: "request.send"; readonly attempt: number; readonly action: ElicitationAction }
  // Stops waiting on the request. The request itself runs on; the attempt fences its late result.
  | { readonly type: "timeout.clear" }
  | { readonly type: "toast.fail"; readonly error?: string }

export type ElicitationDockTransition = {
  readonly state: ElicitationDockState
  readonly effects: readonly ElicitationDockEffect[]
}

const EMPTY_DRAFT: ElicitationDraft = Object.freeze({
  text: Object.freeze({}),
  number: Object.freeze({}),
  flag: Object.freeze({}),
  list: Object.freeze({}),
})

export function elicitationFields(fields: readonly ElicitationField[]) {
  return fields.filter((field) => !("hidden" in field && field.hidden))
}

// Field defaults, overlaid by the draft a previous mount of the dock left behind.
export function createElicitationDockState(
  fields: readonly ElicitationField[],
  cached?: ElicitationDraft,
): ElicitationDockState {
  return {
    status: "answering",
    attempt: 0,
    draft: {
      text: {
        ...Object.fromEntries(
          fields.flatMap((field) => (field.type === "string" ? [[field.key, field.default ?? ""]] : [])),
        ),
        ...cached?.text,
      },
      number: {
        ...Object.fromEntries(
          fields.flatMap((field) =>
            (field.type === "number" || field.type === "integer") && field.default !== undefined
              ? [[field.key, String(field.default)]]
              : [],
          ),
        ),
        ...cached?.number,
      },
      flag: {
        ...Object.fromEntries(
          fields.flatMap((field) => (field.type === "boolean" ? [[field.key, field.default ?? false]] : [])),
        ),
        ...cached?.flag,
      },
      list: {
        ...Object.fromEntries(
          fields.flatMap((field) => (field.type === "multiselect" ? [[field.key, [...(field.default ?? [])]]] : [])),
        ),
        ...cached?.list,
      },
    },
  }
}

export function transitionElicitationDock(
  state: ElicitationDockState,
  event: ElicitationDockEvent,
): ElicitationDockTransition {
  if (state.status === "disposed") return transitionDisposed(state, event)

  if (event.type === "request.succeeded") {
    if (state.status !== "sending" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ status: "replied", attempt: state.attempt, draft: state.draft }, [{ type: "timeout.clear" }])
  }

  if (event.type === "request.failed" || event.type === "request.timed-out") {
    if (state.status !== "sending" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ status: "answering", attempt: state.attempt, draft: state.draft }, [
      { type: "timeout.clear" },
      { type: "toast.fail", error: event.type === "request.failed" ? event.error : undefined },
    ])
  }

  // The server settled the form, from this client or another one: nothing is left to send or keep.
  if (event.type === "resolved") {
    if (state.status === "replied") return unchanged(state)

    return changed({ status: "replied", attempt: state.attempt, draft: state.draft }, [
      ...(state.status === "sending" ? [{ type: "timeout.clear" } as const] : []),
      { type: "cache.delete" },
    ])
  }

  // An unanswered form keeps its draft for when the dock comes back. A reply already sent finishes on its own, and
  // keeps its draft until it settles, in case it fails.
  if (event.type === "disposed") {
    if (state.status === "answering")
      return changed({ status: "disposed", attempt: state.attempt, unsent: undefined }, [
        { type: "cache.save", draft: state.draft },
      ])

    return changed({
      status: "disposed",
      attempt: state.attempt,
      unsent: state.status === "sending" ? state.draft : undefined,
    })
  }

  // Submit, Dismiss, Escape and Cmd+Enter all land here, so only the first of them leaves `answering`.
  if (state.status !== "answering") return unchanged(state)

  // The request leaves before the dock's owner hears of the submit, which may unmount the dock.
  if (event.type === "send") {
    const attempt = state.attempt + 1

    return changed({ status: "sending", attempt, draft: state.draft, action: event.action }, [
      { type: "cache.delete" },
      { type: "request.send", attempt, action: event.action },
      { type: "notify.submit" },
    ])
  }

  const draft = nextDraft(state.draft, event)

  if (draft === state.draft) return unchanged(state)

  return changed({ status: "answering", attempt: state.attempt, draft })
}

function nextDraft(
  draft: ElicitationDraft,
  event: Extract<ElicitationDockEvent, { type: "text.set" | "number.set" | "flag.set" | "list.toggle" }>,
): ElicitationDraft {
  if (event.type === "text.set") {
    if ((draft.text[event.key] ?? "") === event.value) return draft

    return { ...draft, text: { ...draft.text, [event.key]: event.value } }
  }

  if (event.type === "number.set") {
    if ((draft.number[event.key] ?? "") === event.value) return draft

    return { ...draft, number: { ...draft.number, [event.key]: event.value } }
  }

  if (event.type === "flag.set") {
    if ((draft.flag[event.key] ?? false) === event.value) return draft

    return { ...draft, flag: { ...draft.flag, [event.key]: event.value } }
  }

  const current = draft.list[event.key] ?? []

  if (current.includes(event.value) === event.checked) return draft

  return {
    ...draft,
    list: {
      ...draft.list,
      [event.key]: event.checked ? [...current, event.value] : current.filter((value) => value !== event.value),
    },
  }
}

// A reply sent before the dock went away still settles: a failure or timeout reports it and keeps its draft for when
// the dock comes back; a success, or the form settling, drops the draft.
function transitionDisposed(
  state: Extract<ElicitationDockState, { status: "disposed" }>,
  event: ElicitationDockEvent,
): ElicitationDockTransition {
  if (!state.unsent) return unchanged(state)

  const settled: ElicitationDockState = { status: "disposed", attempt: state.attempt, unsent: undefined }

  if (event.type === "resolved") return changed(settled, [{ type: "timeout.clear" }])

  if (event.type !== "request.succeeded" && event.type !== "request.failed" && event.type !== "request.timed-out")
    return unchanged(state)

  if (event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "request.succeeded") return changed(settled, [{ type: "timeout.clear" }])

  return changed(settled, [
    { type: "timeout.clear" },
    { type: "toast.fail", error: event.type === "request.failed" ? event.error : undefined },
    { type: "cache.save", draft: state.unsent },
  ])
}

/** True while a reply or dismissal is in flight, after it settles, and after the dock went away. */
export function isElicitationBusy(state: ElicitationDockState) {
  return state.status !== "answering"
}

export function selectElicitationDraft(state: ElicitationDockState) {
  return state.status === "disposed" ? (state.unsent ?? EMPTY_DRAFT) : state.draft
}

export function buildElicitationAnswer(fields: readonly ElicitationField[], draft: ElicitationDraft): FormAnswer {
  return Object.fromEntries(
    elicitationFields(fields).flatMap((field): Array<[string, FormValue]> => {
      if (field.type === "external") return [[field.key, true]]

      if (field.type === "boolean") return [[field.key, draft.flag[field.key] ?? false]]

      if (field.type === "multiselect") {
        const list = draft.list[field.key] ?? []

        return list.length ? [[field.key, [...list]]] : []
      }

      const text = (field.type === "string" ? draft.text[field.key] : draft.number[field.key])?.trim()

      if (!text) return []

      return [[field.key, field.type === "string" ? text : Number(text)]]
    }),
  )
}

function changed(
  state: ElicitationDockState,
  effects: readonly ElicitationDockEffect[] = [],
): ElicitationDockTransition {
  return { state, effects }
}

function unchanged(state: ElicitationDockState): ElicitationDockTransition {
  return { state, effects: [] }
}
