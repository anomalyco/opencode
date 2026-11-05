import type { FormAnswer, FormInfo, FormOption, FormStringField } from "@opencode/client/promise"

export const WEBSEARCH_PROVIDERS_TIMEOUT_MS = 15_000

export const WEBSEARCH_REPLY_TIMEOUT_MS = 15_000

export const WEBSEARCH_HANDOFF_TIMEOUT_MS = 10_000

// Answered form IDs stay hidden even when a stale form list brings them back; the oldest are forgotten first.
export const WEBSEARCH_REPLIED_LIMIT = 256

const EMPTY_OPTIONS: readonly FormOption[] = []

export type WebSearchNotice = "submit-failed" | "option-unavailable"

export type WebSearchReplyKind = "final" | "choose"

export type WebSearchStep =
  | { readonly type: "replying" }
  // The consent form's `choose` reply is in flight; a provider form may already have arrived.
  | { readonly type: "choosing"; readonly selection: string; readonly providerForm: FormInfo | undefined }
  // `choose` was accepted and the provider form has not arrived yet.
  | { readonly type: "awaiting-provider"; readonly selection: string }

/** The last rendered controls, kept while `<Grow>` animates a settled dock closed. */
export type WebSearchClosingView = {
  readonly specific: boolean
  readonly options: readonly FormOption[]
  readonly selected: string | undefined
}

type WebSearchBase = {
  readonly attempt: number
  readonly connected: boolean
  // The form the request store shows now. A response keeps its own form while this moves on.
  readonly incoming: FormInfo | undefined
  readonly replied: readonly string[]
}

export type WebSearchState =
  | (WebSearchBase & { readonly status: "inactive"; readonly closing: WebSearchClosingView | undefined })
  | (WebSearchBase & { readonly status: "loading"; readonly form: FormInfo })
  | (WebSearchBase & { readonly status: "load-failed"; readonly form: FormInfo; readonly submitFailed: boolean })
  | (WebSearchBase & {
      readonly status: "idle"
      readonly form: FormInfo
      readonly options: readonly FormOption[]
      readonly selected: string | undefined
      readonly notice: WebSearchNotice | undefined
    })
  | (WebSearchBase & {
      readonly status: "responding"
      readonly form: FormInfo
      // Undefined only when a consent form is declined before its providers loaded.
      readonly options: readonly FormOption[] | undefined
      readonly selected: string | undefined
      readonly step: WebSearchStep
    })
  | { readonly status: "disposed" }

export type WebSearchEvent =
  | { readonly type: "request.changed"; readonly form: FormInfo | undefined }
  | { readonly type: "owner.changed" }
  | { readonly type: "connection.changed"; readonly connected: boolean }
  | { readonly type: "select"; readonly value: string }
  | { readonly type: "retry" }
  | { readonly type: "submit"; readonly selection: string | false }
  | { readonly type: "providers.loaded"; readonly attempt: number; readonly options: readonly FormOption[] }
  | { readonly type: "providers.failed"; readonly attempt: number }
  | { readonly type: "providers.timed-out"; readonly attempt: number }
  | {
      readonly type: "reply.succeeded" | "reply.already-settled"
      readonly attempt: number
      readonly formID: string
      readonly kind: WebSearchReplyKind
    }
  | { readonly type: "reply.failed"; readonly attempt: number }
  | { readonly type: "reply.timed-out"; readonly attempt: number }
  | { readonly type: "handoff.timed-out"; readonly attempt: number }
  | { readonly type: "form.created"; readonly form: FormInfo }
  | { readonly type: "form.cancelled"; readonly id: string }
  | { readonly type: "form.replied"; readonly id: string; readonly answer: FormAnswer }
  | { readonly type: "disposed" }

export type WebSearchEffect =
  | {
      readonly type: "providers.load"
      readonly attempt: number
      readonly sessionID: string
      readonly timeoutMs: number
    }
  // Subscribes to form events before the first reply goes out.
  | { readonly type: "respond.start" }
  | {
      readonly type: "reply.send"
      readonly attempt: number
      readonly sessionID: string
      readonly formID: string
      readonly answer: FormAnswer
      readonly kind: WebSearchReplyKind
      readonly timeoutMs: number
    }
  | { readonly type: "handoff.wait"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "respond.finish" }

export type WebSearchTransition = {
  readonly state: WebSearchState
  readonly effects: readonly WebSearchEffect[]
}

type Live = Exclude<WebSearchState, { status: "disposed" }>

type Responding = Extract<WebSearchState, { status: "responding" }>

type Shown = Extract<WebSearchState, { status: "loading" | "load-failed" | "idle" }>

export function createWebSearchState(connected: boolean): WebSearchState {
  return { status: "inactive", attempt: 0, connected, incoming: undefined, replied: [], closing: undefined }
}

export function webSearchProviderField(form: FormInfo) {
  return form.fields.find(
    (field): field is FormStringField => field.type === "string" && field.key === "provider" && !!field.options,
  )
}

export function transitionWebSearch(state: WebSearchState, event: WebSearchEvent): WebSearchTransition {
  if (state.status === "disposed") return same(state)

  switch (event.type) {
    case "disposed":
      return { state: { status: "disposed" }, effects: state.status === "responding" ? [FINISH] : [] }
    case "request.changed":
      return requestChanged(state, event.form)
    case "owner.changed":
      return reset(state, state.connected)
    case "connection.changed":
      return event.connected === state.connected ? same(state) : reset(state, event.connected)
    case "select":
      return select(state, event.value)
    case "retry":
      if ((state.status !== "load-failed" && state.status !== "idle") || webSearchProviderField(state.form))
        return same(state)

      return enter(base(state), state.form, undefined, undefined)
    case "submit":
      return submit(state, event.selection)
    case "providers.loaded":
      if (state.status !== "loading" || state.attempt !== event.attempt) return same(state)

      return {
        state: {
          ...base(state),
          status: "idle",
          form: state.form,
          options: event.options,
          selected: "random",
          notice: undefined,
        },
        effects: [],
      }
    case "providers.failed":
    case "providers.timed-out":
      if (state.status !== "loading" || state.attempt !== event.attempt) return same(state)

      return { state: { ...base(state), status: "load-failed", form: state.form, submitFailed: false }, effects: [] }
    case "reply.succeeded":
    case "reply.already-settled":
      return replySettled(state, event)
    case "reply.failed":
    case "reply.timed-out":
      return replyFailed(state, event.attempt)
    case "handoff.timed-out":
      if (state.status !== "responding" || state.attempt !== event.attempt || state.step.type !== "awaiting-provider")
        return same(state)

      return enter(base(state), active(state.incoming, state.replied), undefined, closingView(state), [FINISH])
    case "form.created":
      return formCreated(state, event.form)
    case "form.cancelled":
      return formSettled(state, event.id, false)
    case "form.replied":
      return formSettled(state, event.id, event.answer.choice === "choose")
  }
}

export type WebSearchView = {
  readonly request: FormInfo | undefined
  readonly specific: boolean
  readonly options: readonly FormOption[]
  readonly selected: string | undefined
  readonly loading: boolean
  readonly loadFailed: boolean
  readonly failed: boolean
  readonly optionUnavailable: boolean
  readonly sending: boolean
}

export function selectWebSearchView(state: WebSearchState): WebSearchView {
  const view = {
    request: undefined,
    specific: false,
    options: EMPTY_OPTIONS,
    selected: "random",
    loading: false,
    loadFailed: false,
    failed: false,
    optionUnavailable: false,
    sending: false,
  }

  if (state.status === "disposed") return view

  if (state.status === "inactive") return { ...view, ...state.closing }

  if (state.status === "loading") return { ...view, request: state.form, loading: true }

  if (state.status === "load-failed")
    return { ...view, request: state.form, loadFailed: true, failed: state.submitFailed }

  return {
    ...view,
    request: state.form,
    specific: !!webSearchProviderField(state.form),
    options: state.options ?? EMPTY_OPTIONS,
    selected: state.selected,
    failed: state.status === "idle" && state.notice === "submit-failed",
    optionUnavailable: state.status === "idle" && state.notice === "option-unavailable",
    sending: state.status === "responding",
  }
}

export type WebSearchDockStatus = "loading" | "failed" | "loadFailed" | "empty" | "unavailable"

export function selectWebSearchDockView(input: {
  readonly request: FormInfo | undefined
  readonly connected: boolean
  readonly sending: boolean
  readonly loading: boolean
  readonly loadFailed: boolean
  readonly failed: boolean
  readonly optionUnavailable: boolean
  readonly specific: boolean
  readonly options: readonly FormOption[]
  readonly hasSelection: boolean
}) {
  // A dock without a request is closing; it keeps its last controls, inert and without status.
  const closing = !input.request
  const busy = closing || input.sending || !input.connected
  const unavailable = input.loading || input.loadFailed || input.options.length === 0

  return {
    busy,
    selectDisabled: busy || unavailable,
    showDisable: !input.specific,
    enableDisabled: busy || unavailable || !input.hasSelection,
    showRetry: !closing && !input.sending && input.loadFailed,
    status: closing || input.sending ? undefined : dockStatus(input),
  }
}

function dockStatus(input: Parameters<typeof selectWebSearchDockView>[0]): WebSearchDockStatus | undefined {
  if (input.loading) return "loading"

  if (input.failed) return "failed"

  if (input.loadFailed) return "loadFailed"

  if (input.options.length === 0) return "empty"

  if (input.optionUnavailable) return "unavailable"
}

const FINISH: WebSearchEffect = { type: "respond.finish" }

function same(state: WebSearchState): WebSearchTransition {
  return { state, effects: [] }
}

function base(state: Live): WebSearchBase {
  return { attempt: state.attempt, connected: state.connected, incoming: state.incoming, replied: state.replied }
}

function active(form: FormInfo | undefined, replied: readonly string[]) {
  return form && !replied.includes(form.id) ? form : undefined
}

function remember(replied: readonly string[], id: string) {
  return replied.includes(id) ? replied : [...replied, id].slice(-WEBSEARCH_REPLIED_LIMIT)
}

function pick(preferred: string | undefined, options: readonly FormOption[]) {
  return preferred && options.some((option) => option.value === preferred) ? preferred : options[0]?.value
}

function hasOption(options: readonly FormOption[], value: string) {
  return options.some((option) => option.value === value)
}

function isProviderFormFor(state: Responding, candidate: FormInfo) {
  return (
    candidate.sessionID === state.form.sessionID &&
    candidate.id !== state.form.id &&
    candidate.metadata?.kind === "websearch.provider" &&
    !!webSearchProviderField(candidate) &&
    !state.replied.includes(candidate.id)
  )
}

function closingView(state: Live): WebSearchClosingView | undefined {
  if (state.status === "inactive") return state.closing

  if (state.status === "loading" || state.status === "load-failed")
    return { specific: false, options: EMPTY_OPTIONS, selected: "random" }

  return {
    specific: !!webSearchProviderField(state.form),
    options: state.options ?? EMPTY_OPTIONS,
    selected: state.selected,
  }
}

/** Shows `form`: a provider form at once, a consent form after its provider list loads. */
function enter(
  next: WebSearchBase,
  form: FormInfo | undefined,
  preferred: string | undefined,
  closing: WebSearchClosingView | undefined,
  effects: readonly WebSearchEffect[] = [],
): WebSearchTransition {
  if (!form) return { state: { ...next, status: "inactive", closing }, effects }
  const field = webSearchProviderField(form)

  if (field) {
    const options = field.options ?? EMPTY_OPTIONS

    return {
      state: { ...next, status: "idle", form, options, selected: pick(preferred, options), notice: undefined },
      effects,
    }
  }

  const attempt = next.attempt + 1

  return {
    state: { ...next, attempt, status: "loading", form },
    effects: [
      ...effects,
      { type: "providers.load", attempt, sessionID: form.sessionID, timeoutMs: WEBSEARCH_PROVIDERS_TIMEOUT_MS },
    ],
  }
}

function requestChanged(state: Live, form: FormInfo | undefined): WebSearchTransition {
  const next = active(form, state.replied)

  if (state.status === "responding") {
    const step = state.step

    // The provider form can reach the store through a form sync while its `form.created` event is missed.
    if (step.type !== "replying" && next && isProviderFormFor(state, next)) {
      if (step.type === "awaiting-provider") return advance({ ...state, incoming: form }, next, step.selection)

      return {
        state: { ...state, incoming: form, step: { ...step, providerForm: step.providerForm ?? next } },
        effects: [],
      }
    }

    // The response keeps its form: the store drops a consent form as soon as `choose` is accepted.
    return form === state.incoming ? same(state) : { state: { ...state, incoming: form }, effects: [] }
  }

  if (state.status === "inactive") {
    if (next) return enter({ ...base(state), incoming: form }, next, undefined, undefined)

    return form === state.incoming ? same(state) : { state: { ...state, incoming: form }, effects: [] }
  }

  if (!next)
    return { state: { ...base(state), incoming: form, status: "inactive", closing: closingView(state) }, effects: [] }

  if (next.id === state.form.id) {
    if (next === state.form && form === state.incoming) return same(state)

    return { state: { ...state, form: next, incoming: form }, effects: [] }
  }

  return enter(
    { ...base(state), incoming: form },
    next,
    state.status === "idle" ? state.selected : undefined,
    undefined,
  )
}

/** Another session or a connection change drops any response and starts over on the current form. */
function reset(state: Live, connected: boolean): WebSearchTransition {
  const effects = state.status === "responding" ? [FINISH] : []
  const next = active(state.incoming, state.replied)
  const fresh = { ...base(state), connected }

  if (state.status === "inactive" || next?.id !== state.form.id)
    return enter(fresh, next, undefined, undefined, effects)

  if (state.status === "loading") return { state: { ...state, connected }, effects }

  if (state.status === "load-failed")
    return { state: { ...fresh, status: "load-failed", form: next, submitFailed: false }, effects }

  if (!state.options) return enter(fresh, next, undefined, undefined, effects)
  const specific = !!webSearchProviderField(next)

  return {
    state: {
      ...fresh,
      status: "idle",
      form: next,
      options: state.options,
      selected: specific ? state.options[0]?.value : "random",
      notice: undefined,
    },
    effects,
  }
}

function select(state: Live, value: string): WebSearchTransition {
  if (state.status !== "idle") return same(state)

  if (webSearchProviderField(state.form) && !hasOption(state.options, value)) return same(state)

  if (value === state.selected && !state.notice) return same(state)

  return { state: { ...state, selected: value, notice: undefined }, effects: [] }
}

function submit(state: Live, selection: string | false): WebSearchTransition {
  if (!state.connected) return same(state)

  if (state.status === "loading" || state.status === "load-failed") {
    if (selection !== false) return same(state)

    return respond(state, undefined, undefined, { type: "replying" }, { choice: "disable" }, "final")
  }

  if (state.status !== "idle") return same(state)

  if (webSearchProviderField(state.form)) {
    if (selection === false || !hasOption(state.options, selection)) return same(state)

    return respond(state, state.options, selection, { type: "replying" }, { provider: selection }, "final")
  }

  if (selection === false)
    return respond(state, state.options, state.selected, { type: "replying" }, { choice: "disable" }, "final")

  if (selection === "random")
    return respond(state, state.options, "random", { type: "replying" }, { choice: "allow" }, "final")

  if (!hasOption(state.options, selection)) return same(state)

  return respond(
    state,
    state.options,
    selection,
    { type: "choosing", selection, providerForm: undefined },
    { choice: "choose" },
    "choose",
  )
}

function respond(
  state: Shown,
  options: readonly FormOption[] | undefined,
  selected: string | undefined,
  step: WebSearchStep,
  answer: FormAnswer,
  kind: WebSearchReplyKind,
): WebSearchTransition {
  const attempt = state.attempt + 1

  return {
    state: { ...base(state), attempt, status: "responding", form: state.form, options, selected, step },
    effects: [{ type: "respond.start" }, send(attempt, state.form, answer, kind)],
  }
}

function send(attempt: number, form: FormInfo, answer: FormAnswer, kind: WebSearchReplyKind): WebSearchEffect {
  return {
    type: "reply.send",
    attempt,
    sessionID: form.sessionID,
    formID: form.id,
    answer,
    kind,
    timeoutMs: WEBSEARCH_REPLY_TIMEOUT_MS,
  }
}

/** Answers the provider form with the selection, or stops there when the selection is no longer offered. */
function advance(state: Responding, form: FormInfo, selection: string): WebSearchTransition {
  const options = webSearchProviderField(form)?.options ?? EMPTY_OPTIONS

  if (!hasOption(options, selection))
    return {
      state: {
        ...base(state),
        status: "idle",
        form,
        options,
        selected: options[0]?.value,
        notice: "option-unavailable",
      },
      effects: [FINISH],
    }

  const attempt = state.attempt + 1

  return {
    state: {
      ...base(state),
      attempt,
      status: "responding",
      form,
      options,
      selected: selection,
      step: { type: "replying" },
    },
    effects: [send(attempt, form, { provider: selection }, "final")],
  }
}

function replySettled(
  state: Live,
  event: Extract<WebSearchEvent, { type: "reply.succeeded" | "reply.already-settled" }>,
): WebSearchTransition {
  const replied = remember(state.replied, event.formID)

  if (state.status !== "responding" || state.attempt !== event.attempt) {
    // A reply that timed out can still land; the server has the answer, so its form is done.
    if (
      event.kind === "final" &&
      (state.status === "loading" || state.status === "load-failed" || state.status === "idle") &&
      state.form.id === event.formID
    )
      return enter({ ...base(state), replied }, active(state.incoming, replied), undefined, closingView(state))

    return replied === state.replied ? same(state) : { state: { ...state, replied }, effects: [] }
  }

  const step = state.step

  // Only an accepted `choose` leads to a provider form; a consent form settled elsewhere does not.
  if (step.type === "choosing" && event.type === "reply.succeeded") {
    const next = active(state.incoming, replied)
    const settled = { ...state, replied }
    const target = step.providerForm ?? (next && isProviderFormFor(settled, next) ? next : undefined)

    if (target) return advance(settled, target, step.selection)
    const attempt = state.attempt + 1

    return {
      state: { ...settled, attempt, step: { type: "awaiting-provider", selection: step.selection } },
      effects: [{ type: "handoff.wait", attempt, timeoutMs: WEBSEARCH_HANDOFF_TIMEOUT_MS }],
    }
  }

  return enter({ ...base(state), replied }, active(state.incoming, replied), state.selected, closingView(state), [
    FINISH,
  ])
}

function replyFailed(state: Live, attempt: number): WebSearchTransition {
  if (state.status !== "responding" || state.attempt !== attempt || state.step.type === "awaiting-provider")
    return same(state)
  const next = active(state.incoming, state.replied)

  if (next?.id !== state.form.id) return enter(base(state), next, state.selected, closingView(state), [FINISH])

  if (!state.options)
    return { state: { ...base(state), status: "load-failed", form: next, submitFailed: true }, effects: [FINISH] }

  return {
    state: {
      ...base(state),
      status: "idle",
      form: next,
      options: state.options,
      selected: state.selected,
      notice: "submit-failed",
    },
    effects: [FINISH],
  }
}

function formCreated(state: Live, form: FormInfo): WebSearchTransition {
  if (state.status !== "responding" || state.step.type === "replying" || !isProviderFormFor(state, form))
    return same(state)
  const step = state.step

  if (step.type === "awaiting-provider") return advance(state, form, step.selection)

  if (step.providerForm) return same(state)

  return { state: { ...state, step: { ...step, providerForm: form } }, effects: [] }
}

function formSettled(state: Live, id: string, choose: boolean): WebSearchTransition {
  if (state.status !== "responding") return same(state)
  const step = state.step
  const replied = remember(state.replied, id)

  if (id === state.form.id) {
    // The event stream echoes our own `choose`; the handoff goes on.
    if (choose && step.type !== "replying")
      return replied === state.replied ? same(state) : { state: { ...state, replied }, effects: [] }

    return enter({ ...base(state), replied }, active(state.incoming, replied), state.selected, closingView(state), [
      FINISH,
    ])
  }

  if (step.type === "choosing" && step.providerForm?.id === id)
    return { state: { ...state, replied, step: { ...step, providerForm: undefined } }, effects: [] }

  return same(state)
}
