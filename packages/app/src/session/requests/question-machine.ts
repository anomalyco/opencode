import type { FormAnswer, FormInfo, FormMultiselectField, FormStringField } from "@opencode/client/promise"

// A reply that never settles gives the dock back after this long, so it cannot stay disabled forever.
export const QUESTION_REQUEST_TIMEOUT_MS = 30_000

type QuestionField = FormStringField | FormMultiselectField

export type QuestionSpec = {
  readonly field: QuestionField
  readonly header: string
  readonly question: string
  readonly options: readonly { value: string; label: string; description?: string }[]
  readonly multiple: boolean
  readonly custom: boolean
}

// One question's answer. Picked options and the typed answer are kept apart, so typing an option's value into the
// field, or clearing the field, never picks or unpicks that option.
export type QuestionDraft = {
  readonly selected: readonly string[]
  readonly customText: string
  readonly customSelected: boolean
}

export type QuestionCacheSnapshot = {
  readonly tab: number
  readonly drafts: readonly QuestionDraft[]
}

export type QuestionSendAction = { readonly type: "reply"; readonly answer: FormAnswer } | { readonly type: "dismiss" }

export type QuestionDockState =
  | {
      readonly status: "answering"
      readonly attempt: number
      readonly tab: number
      readonly drafts: readonly QuestionDraft[]
    }
  | {
      readonly status: "sending"
      readonly attempt: number
      readonly tab: number
      readonly drafts: readonly QuestionDraft[]
      readonly action: QuestionSendAction
    }
  | {
      readonly status: "replied"
      readonly attempt: number
      readonly tab: number
      readonly drafts: readonly QuestionDraft[]
    }
  // `unsent` is the draft of a reply still in flight when the dock went away, kept until the reply settles.
  | { readonly status: "disposed"; readonly attempt: number; readonly unsent: QuestionCacheSnapshot | undefined }

export type QuestionDockEvent =
  | { readonly type: "tab.select"; readonly tab: number }
  | { readonly type: "option.pick"; readonly value: string; readonly multiple: boolean }
  | { readonly type: "custom.input"; readonly text: string; readonly multiple: boolean }
  | { readonly type: "custom.select"; readonly multiple: boolean }
  | { readonly type: "custom.deselect" }
  | { readonly type: "send"; readonly action: QuestionSendAction }
  | { readonly type: "request.succeeded"; readonly attempt: number }
  | { readonly type: "request.failed"; readonly attempt: number; readonly error?: string }
  | { readonly type: "request.timed-out"; readonly attempt: number }
  | { readonly type: "resolved" }
  | { readonly type: "disposed" }

export type QuestionDockEffect =
  | { readonly type: "notify.submit" }
  | { readonly type: "cache.save"; readonly snapshot: QuestionCacheSnapshot }
  | { readonly type: "cache.delete" }
  | { readonly type: "request.send"; readonly attempt: number; readonly action: QuestionSendAction }
  | { readonly type: "request.abort" }
  | { readonly type: "toast.fail"; readonly error?: string }

export type QuestionDockTransition = {
  readonly state: QuestionDockState
  readonly effects: readonly QuestionDockEffect[]
}

const EMPTY_DRAFT: QuestionDraft = Object.freeze({ selected: Object.freeze([]), customText: "", customSelected: false })

export function questionSpecs(request: FormInfo): QuestionSpec[] {
  return request.fields
    .filter((field): field is QuestionField => field.type === "string" || field.type === "multiselect")
    .map((field) => ({
      field,
      header: field.title ?? "",
      question: field.description ?? field.title ?? "",
      options: field.type === "string" ? (field.options ?? []) : field.options,
      multiple: field.type === "multiselect",
      custom: (field.type === "string" && !field.options) || field.custom === true,
    }))
}

export function createQuestionDockState(count: number, cached?: QuestionCacheSnapshot): QuestionDockState {
  return {
    status: "answering",
    attempt: 0,
    tab: Math.max(0, Math.min(count - 1, cached?.tab ?? 0)),
    drafts: Array.from({ length: count }, (_, index) => cached?.drafts[index] ?? EMPTY_DRAFT),
  }
}

export function transitionQuestionDock(state: QuestionDockState, event: QuestionDockEvent): QuestionDockTransition {
  if (state.status === "disposed") return transitionDisposed(state, event)

  if (event.type === "request.succeeded") {
    if (state.status !== "sending" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ status: "replied", attempt: state.attempt, tab: state.tab, drafts: state.drafts })
  }

  if (event.type === "request.failed" || event.type === "request.timed-out") {
    if (state.status !== "sending" || state.attempt !== event.attempt) return unchanged(state)

    const next: QuestionDockState = {
      status: "answering",
      attempt: state.attempt,
      tab: state.tab,
      drafts: state.drafts,
    }

    if (event.type === "request.failed") return changed(next, [{ type: "toast.fail", error: event.error }])

    return changed(next, [{ type: "request.abort" }, { type: "toast.fail" }])
  }

  // The server settled the form, from this client or another one: nothing is left to send or keep.
  if (event.type === "resolved") {
    if (state.status !== "answering" && state.status !== "sending") return unchanged(state)

    return changed({ status: "replied", attempt: state.attempt, tab: state.tab, drafts: state.drafts }, [
      ...(state.status === "sending" ? [{ type: "request.abort" } as const] : []),
      { type: "cache.delete" },
    ])
  }

  // An unanswered form keeps its draft for when the dock comes back. A reply already sent finishes on its own, and
  // keeps its draft until it settles, in case it fails.
  if (event.type === "disposed") {
    const snapshot = { tab: state.tab, drafts: state.drafts }

    if (state.status === "answering")
      return changed({ status: "disposed", attempt: state.attempt, unsent: undefined }, [
        { type: "cache.save", snapshot },
      ])

    return changed({
      status: "disposed",
      attempt: state.attempt,
      unsent: state.status === "sending" ? snapshot : undefined,
    })
  }

  if (state.status !== "answering") return unchanged(state)

  // The request leaves before the dock's owner hears of the submit, which may unmount the dock.
  if (event.type === "send") {
    const attempt = state.attempt + 1

    return changed({ status: "sending", attempt, tab: state.tab, drafts: state.drafts, action: event.action }, [
      { type: "cache.delete" },
      { type: "request.send", attempt, action: event.action },
      { type: "notify.submit" },
    ])
  }

  if (event.type === "tab.select") {
    if (event.tab === state.tab || event.tab < 0 || event.tab >= state.drafts.length) return unchanged(state)

    return changed({ ...state, tab: event.tab })
  }

  const draft = state.drafts[state.tab] ?? EMPTY_DRAFT

  return edit(state, draft, nextDraft(draft, event))
}

function nextDraft(
  draft: QuestionDraft,
  event: Extract<QuestionDockEvent, { type: "option.pick" | "custom.input" | "custom.select" | "custom.deselect" }>,
): QuestionDraft {
  if (event.type === "option.pick") {
    if (!event.multiple) {
      if (draft.selected.length === 1 && draft.selected[0] === event.value && !draft.customSelected) return draft

      return { selected: [event.value], customText: draft.customText, customSelected: false }
    }

    return {
      selected: draft.selected.includes(event.value)
        ? draft.selected.filter((value) => value !== event.value)
        : [...draft.selected, event.value],
      customText: draft.customText,
      customSelected: draft.customSelected,
    }
  }

  if (event.type === "custom.deselect") {
    if (!draft.customSelected) return draft

    return { selected: draft.selected, customText: draft.customText, customSelected: false }
  }

  const text = event.type === "custom.input" ? event.text : draft.customText
  const selected = event.multiple ? draft.selected : []

  if (draft.customSelected && text === draft.customText && selected.length === draft.selected.length) return draft

  return { selected, customText: text, customSelected: true }
}

function edit(
  state: Extract<QuestionDockState, { status: "answering" }>,
  draft: QuestionDraft,
  next: QuestionDraft,
): QuestionDockTransition {
  if (next === draft) return unchanged(state)

  return changed({ ...state, drafts: state.drafts.map((item, index) => (index === state.tab ? next : item)) })
}

// A reply sent before the dock went away still settles: a failure or timeout reports it and keeps its draft for when
// the dock comes back; a success, or the form settling, drops the draft.
function transitionDisposed(
  state: Extract<QuestionDockState, { status: "disposed" }>,
  event: QuestionDockEvent,
): QuestionDockTransition {
  if (!state.unsent) return unchanged(state)

  const settled: QuestionDockState = { status: "disposed", attempt: state.attempt, unsent: undefined }

  if (event.type === "resolved") return changed(settled, [{ type: "request.abort" }])

  if (event.type !== "request.succeeded" && event.type !== "request.failed" && event.type !== "request.timed-out")
    return unchanged(state)

  if (event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "request.succeeded") return changed(settled)

  const save = { type: "cache.save", snapshot: state.unsent } as const

  if (event.type === "request.failed") return changed(settled, [{ type: "toast.fail", error: event.error }, save])

  return changed(settled, [{ type: "request.abort" }, { type: "toast.fail" }, save])
}

export function isQuestionBusy(state: QuestionDockState) {
  return state.status !== "answering"
}

export function questionTab(state: QuestionDockState) {
  return state.status === "disposed" ? 0 : state.tab
}

export function questionDraft(state: QuestionDockState, tab: number) {
  return (state.status === "disposed" ? undefined : state.drafts[tab]) ?? EMPTY_DRAFT
}

// The values one question answers with: picked options, then the typed answer when it is on and not one of them.
export function questionAnswer(spec: Pick<QuestionSpec, "multiple">, draft: QuestionDraft): string[] {
  const custom = draft.customSelected ? draft.customText.trim() : ""

  if (!spec.multiple) {
    if (draft.customSelected) return custom ? [custom] : []

    return draft.selected.slice(0, 1)
  }

  if (!custom || draft.selected.includes(custom)) return [...draft.selected]

  return [...draft.selected, custom]
}

export function buildFormAnswer(questions: readonly QuestionSpec[], drafts: readonly QuestionDraft[]): FormAnswer {
  return Object.fromEntries(
    questions.flatMap((question, index) => {
      const answer = questionAnswer(question, drafts[index] ?? EMPTY_DRAFT)

      if (answer.length === 0) return []

      return [[question.field.key, question.multiple ? answer : answer[0]!]]
    }),
  )
}

function changed(state: QuestionDockState, effects: readonly QuestionDockEffect[] = []): QuestionDockTransition {
  return { state, effects }
}

function unchanged(state: QuestionDockState): QuestionDockTransition {
  return { state, effects: [] }
}
