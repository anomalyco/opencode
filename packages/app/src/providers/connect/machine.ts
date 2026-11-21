import type {
  FormAnswer,
  IntegrationCommandConnectOutput,
  IntegrationInfo,
  IntegrationMethod,
  IntegrationOauthConnectOutput,
} from "@opencode/client/promise"
import {
  createProviderFormState,
  selectProviderFormView,
  transitionProviderForm,
  type ProviderActiveForm,
  type ProviderFormEvent,
  type ProviderFormInput,
} from "./form-machine"

export type ProviderConnectMethod = Exclude<IntegrationMethod, { type: "env" }>

export type ProviderAuthorization = IntegrationOauthConnectOutput["data"]

export type ProviderCommandAttempt = IntegrationCommandConnectOutput["data"]

export type ProviderCatalog = {
  readonly integration?: IntegrationInfo
  readonly methods: ReadonlyArray<ProviderConnectMethod>
}

/** What the selected method has produced so far. It decides which view the dialog shows. */
export type ProviderSignIn =
  | { readonly kind: "key"; readonly method: Extract<ProviderConnectMethod, { type: "key" }> }
  | {
      readonly kind: "browser"
      readonly method: Extract<ProviderConnectMethod, { type: "oauth" }>
      readonly authorization: ProviderAuthorization
      readonly browserFailed: boolean
      /** Set when the attempt also takes the redirect URL pasted from a browser that cannot reach the server. */
      readonly paste?: ProviderPaste
    }
  | {
      readonly kind: "code"
      readonly method: Extract<ProviderConnectMethod, { type: "oauth" }>
      readonly authorization: ProviderAuthorization
    }
  | {
      readonly kind: "command"
      readonly method: Extract<ProviderConnectMethod, { type: "command" }>
      readonly command: ProviderCommandAttempt
      readonly output: string
    }
  | { readonly kind: "external"; readonly method: Extract<ProviderConnectMethod, { type: "external" }> }

/** A sign-in the user completes by typing a secret: an API key or a pasted authorization code. */
export type ProviderTypedSignIn = Extract<ProviderSignIn, { kind: "key" | "code" }>

/** A sign-in that finishes outside the dialog while the dialog polls the server. */
export type ProviderPolledSignIn = Extract<ProviderSignIn, { kind: "browser" | "command" }>

export type ProviderEntryError = { readonly type: "required" } | { readonly type: "rejected"; readonly message: string }

/** The pasted redirect URL of a browser sign-in. The browser's own callback still completes the sign-in meanwhile. */
export type ProviderPaste =
  /** `open` is whether the user showed or hid the field; undefined leaves it to the server (open on a remote one). */
  | { readonly status: "editing"; readonly value: string; readonly error?: ProviderEntryError; readonly open?: boolean }
  | { readonly status: "submitting"; readonly value: string }
  /** The server took the URL and finishes the sign-in; polling reports how it ends. */
  | { readonly status: "accepted"; readonly value: string }

export type ProviderRetry =
  | { readonly type: "start" }
  | { readonly type: "poll"; readonly signIn: Extract<ProviderSignIn, { kind: "browser" }> }
  | { readonly type: "refresh"; readonly signIn: ProviderSignIn }

/** Every phase after the user picks a method. `attempt` identifies the async work the phase accepts results from. */
type Selection = {
  readonly attempt: number
  readonly catalog: ProviderCatalog
  readonly methodIndex: number
  readonly answer?: FormAnswer
}

export type ProviderConnectState =
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "choosing"; readonly attempt: number; readonly catalog: ProviderCatalog }
  | (Selection & { readonly status: "form"; readonly form: ProviderActiveForm })
  | (Selection & { readonly status: "starting" })
  | (Selection & {
      readonly status: "entering"
      readonly signIn: ProviderTypedSignIn
      readonly error?: ProviderEntryError
    })
  | (Selection & { readonly status: "submitting"; readonly signIn: ProviderTypedSignIn })
  | (Selection & { readonly status: "waiting"; readonly signIn: ProviderPolledSignIn })
  | (Selection & { readonly status: "refreshing"; readonly signIn: ProviderSignIn })
  | (Selection & { readonly status: "connected"; readonly signIn: ProviderSignIn })
  | (Selection & { readonly status: "failed"; readonly error: string; readonly retry: ProviderRetry })
  | { readonly status: "disposed" }

export type ProviderPollOutcome =
  | { readonly status: "pending"; readonly output?: string }
  | { readonly status: "complete" }
  /** The attempt is over on the server; a retry starts a new one. */
  | { readonly status: "failed"; readonly error: string }
  /** The status request failed; the attempt may still be open on the server. */
  | { readonly status: "unreachable"; readonly error: string }

export type ProviderConnectEvent =
  | {
      readonly type: "integration.loaded"
      readonly attempt: number
      readonly catalog: ProviderCatalog
      readonly manual: boolean
    }
  | { readonly type: "method.selected"; readonly index: number }
  | { readonly type: "form"; readonly event: ProviderFormInput }
  /** `browser` is the form's attempt for this open; `opened` is false when it failed or did not answer in time. */
  | {
      readonly type: "form.browser.opened"
      readonly attempt: number
      readonly browser: number
      readonly opened: boolean
    }
  | { readonly type: "entry.submitted"; readonly value: string }
  | { readonly type: "paste.changed"; readonly value: string }
  | { readonly type: "paste.toggled"; readonly open: boolean }
  | { readonly type: "paste.submitted" }
  /** The server took the pasted URL; the sign-in still settles through polling. */
  | { readonly type: "paste.accepted"; readonly attempt: number }
  | { readonly type: "paste.rejected"; readonly attempt: number; readonly error: string }
  | { readonly type: "oauth.started"; readonly attempt: number; readonly authorization: ProviderAuthorization }
  | { readonly type: "command.started"; readonly attempt: number; readonly command: ProviderCommandAttempt }
  | { readonly type: "external.saved"; readonly attempt: number }
  | { readonly type: "start.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "browser.open" }
  | { readonly type: "browser.opened"; readonly attemptID: string; readonly opened: boolean }
  | { readonly type: "polled"; readonly attempt: number; readonly outcome: ProviderPollOutcome }
  | { readonly type: "submit.succeeded"; readonly attempt: number }
  | { readonly type: "submit.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "refresh.succeeded"; readonly attempt: number }
  | { readonly type: "refresh.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "retry" }
  | { readonly type: "refresh" }
  | { readonly type: "back" }
  | { readonly type: "disposed" }

export type ProviderConnectEffect =
  | { readonly type: "load"; readonly attempt: number }
  | {
      readonly type: "start"
      readonly attempt: number
      readonly method: Exclude<ProviderConnectMethod, { type: "key" }>
      readonly answer?: FormAnswer
    }
  | { readonly type: "open.browser"; readonly attemptID: string; readonly url: string }
  | {
      readonly type: "form.open.browser"
      readonly attempt: number
      readonly browser: number
      readonly url: string
      readonly timeoutMs: number
    }
  | { readonly type: "poll"; readonly attempt: number; readonly signIn: ProviderPolledSignIn; readonly delay: boolean }
  | { readonly type: "poll.stop" }
  | { readonly type: "cancel"; readonly target: "oauth" | "command"; readonly attemptID: string }
  | {
      readonly type: "submit"
      readonly attempt: number
      readonly signIn: ProviderTypedSignIn
      readonly value: string
      readonly answer?: FormAnswer
    }
  | {
      readonly type: "paste"
      readonly attempt: number
      readonly signIn: Extract<ProviderSignIn, { kind: "browser" }>
      readonly value: string
    }
  | { readonly type: "refresh"; readonly attempt: number; readonly method: ProviderConnectMethod }
  /** Reloads the catalogs without reporting back, for a credential saved after the dialog moved on. */
  | { readonly type: "sync" }
  | { readonly type: "complete"; readonly method: ProviderConnectMethod }

export type ProviderConnectTransition = {
  readonly state: ProviderConnectState
  readonly effects: ReadonlyArray<ProviderConnectEffect>
}

// Same order as the TUI: browser and command sign-ins first, API keys last.
export function connectMethods(integration: IntegrationInfo) {
  return integration.methods
    .filter((method): method is ProviderConnectMethod => method.type !== "env")
    .toSorted((a, b) => Number(a.type === "key") - Number(b.type === "key"))
}

export function startProviderConnect(): ProviderConnectTransition {
  return { state: { status: "loading", attempt: 0 }, effects: [{ type: "load", attempt: 0 }] }
}

export function transitionProviderConnect(
  state: ProviderConnectState,
  event: ProviderConnectEvent,
): ProviderConnectTransition {
  // A server attempt that opened after the dialog moved on is closed again, whatever the state.
  if (event.type === "oauth.started" && !startedHere(state, event.attempt, "oauth"))
    return unchanged(state, [{ type: "cancel", target: "oauth", attemptID: event.authorization.attemptID }])

  if (event.type === "command.started" && !startedHere(state, event.attempt, "command"))
    return unchanged(state, [{ type: "cancel", target: "command", attemptID: event.command.attemptID }])

  // Back does not undo a request the server already took: a credential saved after the dialog moved on
  // still has to reach the catalogs, without moving the dialog or reporting the connection.
  if (savedElsewhere(state, event)) return unchanged(state, [{ type: "sync" }])

  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cleanup(state) }

  if ("attempt" in event && event.attempt !== state.attempt) return unchanged(state)

  if (state.status === "loading") {
    if (event.type !== "integration.loaded") return unchanged(state)

    if (!event.manual && event.catalog.methods.length === 1) return select(event.catalog, 0, state.attempt + 1)

    return unchanged({ status: "choosing", attempt: state.attempt, catalog: event.catalog })
  }

  if (event.type === "method.selected") {
    if (!state.catalog.methods[event.index]) return unchanged(state)
    const next = select(state.catalog, event.index, state.attempt + 1)

    return { state: next.state, effects: [...cleanup(state), ...next.effects] }
  }

  if (state.status === "choosing") return unchanged(state)

  if (event.type === "back")
    return {
      state: { status: "choosing", attempt: state.attempt + 1, catalog: state.catalog },
      effects: cleanup(state),
    }

  if (event.type === "browser.open") {
    const signIn = "signIn" in state ? state.signIn : undefined

    if (signIn?.kind !== "browser" && signIn?.kind !== "code") return unchanged(state)

    return unchanged(state, [
      { type: "open.browser", attemptID: signIn.authorization.attemptID, url: signIn.authorization.url },
    ])
  }

  if (event.type === "browser.opened") {
    if (state.status !== "waiting" && state.status !== "refreshing" && state.status !== "connected")
      return unchanged(state)

    if (state.signIn.kind !== "browser" || state.signIn.authorization.attemptID !== event.attemptID)
      return unchanged(state)

    return unchanged({ ...state, signIn: { ...state.signIn, browserFailed: !event.opened } })
  }

  if (state.status === "form") {
    if (event.type === "form") return form(state, event.event)

    if (event.type !== "form.browser.opened") return unchanged(state)

    return form(state, { type: "external.opened", attempt: event.browser, opened: event.opened })
  }

  if (state.status === "starting") return started(state, event)

  if (state.status === "entering") {
    if (event.type !== "entry.submitted") return unchanged(state)

    if (!event.value.trim()) return unchanged({ ...state, error: { type: "required" } })

    const attempt = state.attempt + 1

    return {
      state: { ...selection(state, attempt), status: "submitting", signIn: state.signIn },
      effects: [{ type: "submit", attempt, signIn: state.signIn, value: event.value, answer: state.answer }],
    }
  }

  if (state.status === "submitting") {
    if (event.type === "submit.succeeded") return refresh(state, state.signIn)

    if (event.type !== "submit.failed") return unchanged(state)

    return unchanged({
      ...selection(state, state.attempt),
      status: "entering",
      signIn: state.signIn,
      error: { type: "rejected", message: event.error },
    })
  }

  if (state.status === "waiting") return polled(state, event)

  if (state.status === "refreshing") {
    if (event.type === "refresh.succeeded")
      return {
        state: { ...selection(state, state.attempt), status: "connected", signIn: state.signIn },
        effects: [{ type: "complete", method: state.signIn.method }],
      }

    if (event.type !== "refresh.failed") return unchanged(state)

    return unchanged({
      ...selection(state, state.attempt),
      status: "failed",
      error: event.error,
      retry: { type: "refresh", signIn: state.signIn },
    })
  }

  if (state.status === "connected") return event.type === "refresh" ? refresh(state, state.signIn) : unchanged(state)

  if (event.type !== "retry") return unchanged(state)

  if (state.retry.type === "refresh") return refresh(state, state.retry.signIn)

  if (state.retry.type === "poll") return poll(state, state.retry.signIn)

  // The form was already answered, so a retry goes straight back to the server.
  return select(state.catalog, state.methodIndex, state.attempt + 1, state.answer ?? {})
}

export type ProviderConnectScreen =
  | "busy"
  | "methods"
  | "environment-only"
  | "form"
  | "failed"
  | "key"
  | "code"
  | "browser"
  | "command"

export function selectProviderConnectView(state: ProviderConnectState) {
  const catalog = "catalog" in state ? state.catalog : undefined
  const methodIndex = "methodIndex" in state ? state.methodIndex : undefined
  const signIn = "signIn" in state ? state.signIn : undefined
  const authorization = signIn?.kind === "browser" || signIn?.kind === "code" ? signIn.authorization : undefined

  return {
    status: state.status,
    screen: screen(state),
    integration: catalog?.integration,
    methods: catalog?.methods ?? [],
    methodIndex,
    method: methodIndex === undefined ? undefined : catalog?.methods.at(methodIndex),
    authorization,
    browserFailed: signIn?.kind === "browser" && signIn.browserFailed,
    commandOutput: signIn?.kind === "command" ? signIn.output : "",
    form: state.status === "form" ? selectProviderFormView(state.form) : undefined,
    entryError: state.status === "entering" ? state.error : undefined,
    paste:
      state.status === "waiting" && signIn?.kind === "browser" && signIn.paste ? pasteView(signIn.paste) : undefined,
    // A typed secret is sent and the catalogs are refreshing: the form takes no second submit.
    submitting: state.status === "submitting" || state.status === "refreshing",
    error: state.status === "failed" ? state.error : undefined,
    // Closing on a stray backdrop click would abandon a sign-in the user is finishing in the browser.
    authorizing:
      authorization !== undefined &&
      (state.status === "waiting" ||
        state.status === "entering" ||
        state.status === "submitting" ||
        state.status === "refreshing"),
  }
}

export type ProviderConnectView = ReturnType<typeof selectProviderConnectView>

function screen(state: ProviderConnectState): ProviderConnectScreen {
  if (state.status === "choosing") return state.catalog.methods.length > 0 ? "methods" : "environment-only"

  if (state.status === "form") return "form"

  if (state.status === "failed") return "failed"

  // An external method has no view of its own, so it shows progress until the dialog moves on.
  if ("signIn" in state && state.signIn.kind !== "external") return state.signIn.kind

  return "busy"
}

function select(
  catalog: ProviderCatalog,
  methodIndex: number,
  attempt: number,
  answer?: FormAnswer,
): ProviderConnectTransition {
  const method = catalog.methods[methodIndex]
  // An answered form already holds the defaults of its hidden fields; one with nothing to ask answers itself.
  const form = answer ? undefined : createProviderFormState(method.type === "command" ? undefined : method.form)

  if (form?.status === "active") return unchanged({ status: "form", attempt, catalog, methodIndex, form })

  const resolved = answer ?? form?.answer ?? {}
  const base = { attempt, catalog, methodIndex, answer: Object.keys(resolved).length ? resolved : undefined }

  if (method.type === "key") return unchanged({ ...base, status: "entering", signIn: { kind: "key", method } })

  return { state: { ...base, status: "starting" }, effects: [{ type: "start", attempt, method, answer: base.answer }] }
}

// Moves the form one step on; an answered form starts the method with the answer.
function form(state: Extract<ProviderConnectState, { status: "form" }>, event: ProviderFormEvent) {
  const next = transitionProviderForm(state.form, event)

  if (next.state === state.form) return unchanged(state)

  if (next.state.status === "completed")
    return select(state.catalog, state.methodIndex, state.attempt + 1, next.state.answer)

  return {
    state: { ...state, form: next.state },
    effects: next.effects.map(
      (effect): ProviderConnectEffect => ({
        type: "form.open.browser",
        attempt: state.attempt,
        browser: effect.attempt,
        url: effect.url,
        timeoutMs: effect.timeoutMs,
      }),
    ),
  }
}

function started(
  state: Extract<ProviderConnectState, { status: "starting" }>,
  event: ProviderConnectEvent,
): ProviderConnectTransition {
  const method = state.catalog.methods[state.methodIndex]

  if (event.type === "start.failed")
    return unchanged({
      ...selection(state, state.attempt),
      status: "failed",
      error: event.error,
      retry: { type: "start" },
    })

  if (event.type === "external.saved" && method.type === "external") return refresh(state, { kind: "external", method })

  if (event.type === "command.started" && method.type === "command")
    return poll(state, { kind: "command", method, command: event.command, output: "" })

  if (event.type !== "oauth.started" || method.type !== "oauth") return unchanged(state)
  const authorization = event.authorization

  // Same as `opencode auth login`: hand the user straight to the browser instead of asking them to click a link.
  const open: ProviderConnectEffect = {
    type: "open.browser",
    attemptID: authorization.attemptID,
    url: authorization.url,
  }

  if (authorization.mode === "code")
    return {
      state: {
        ...selection(state, state.attempt),
        status: "entering",
        signIn: { kind: "code", method, authorization },
      },
      effects: [open],
    }

  const next = poll(state, { kind: "browser", method, authorization, browserFailed: false })

  return { state: next.state, effects: [open, ...next.effects] }
}

function polled(
  state: Extract<ProviderConnectState, { status: "waiting" }>,
  event: ProviderConnectEvent,
): ProviderConnectTransition {
  if (
    event.type === "paste.changed" ||
    event.type === "paste.toggled" ||
    event.type === "paste.submitted" ||
    event.type === "paste.accepted" ||
    event.type === "paste.rejected"
  )
    return pasted(state, event)

  if (event.type !== "polled") return unchanged(state)
  const outcome = event.outcome

  if (outcome.status === "complete") return refresh(state, state.signIn)

  if (outcome.status === "pending") {
    const next =
      state.signIn.kind === "command" ? { ...state, signIn: { ...state.signIn, output: outcome.output ?? "" } } : state

    return { state: next, effects: [{ type: "poll", attempt: state.attempt, signIn: next.signIn, delay: true }] }
  }

  // Only an OAuth attempt stays open on the server after its status request fails, so only it can resume.
  const retry: ProviderRetry =
    outcome.status === "unreachable" && state.signIn.kind === "browser"
      ? { type: "poll", signIn: state.signIn }
      : { type: "start" }

  return unchanged({ ...selection(state, state.attempt), status: "failed", error: outcome.error, retry })
}

// A paste only hands the server the URL: polling keeps running and reports how the sign-in ends.
function pasted(
  state: Extract<ProviderConnectState, { status: "waiting" }>,
  event: Extract<
    ProviderConnectEvent,
    { type: "paste.changed" | "paste.toggled" | "paste.submitted" | "paste.accepted" | "paste.rejected" }
  >,
): ProviderConnectTransition {
  const signIn = state.signIn

  if (signIn.kind !== "browser" || !signIn.paste) return unchanged(state)
  const paste = signIn.paste
  const set = (next: ProviderPaste) => ({ ...state, signIn: { ...signIn, paste: next } })

  if (event.type === "paste.toggled") {
    if (paste.status !== "editing" || paste.open === event.open) return unchanged(state)

    return unchanged(set({ ...paste, open: event.open }))
  }

  if (event.type === "paste.changed") {
    if (paste.status !== "editing" || (event.value === paste.value && !paste.error)) return unchanged(state)

    return unchanged(set({ status: "editing", value: event.value, open: paste.open }))
  }

  if (event.type === "paste.submitted") {
    if (paste.status !== "editing") return unchanged(state)
    const value = paste.value.trim()

    if (!value)
      return unchanged(set({ status: "editing", value: paste.value, error: { type: "required" }, open: true }))

    return {
      state: set({ status: "submitting", value: paste.value }),
      effects: [{ type: "paste", attempt: state.attempt, signIn, value }],
    }
  }

  if (paste.status !== "submitting") return unchanged(state)

  if (event.type === "paste.accepted") return unchanged(set({ status: "accepted", value: paste.value }))

  return unchanged(
    set({ status: "editing", value: paste.value, error: { type: "rejected", message: event.error }, open: true }),
  )
}

function pasteView(paste: ProviderPaste) {
  return {
    value: paste.value,
    error: paste.status === "editing" ? paste.error : undefined,
    locked: paste.status !== "editing",
    // A URL the user already sent keeps the field in view.
    open: paste.status === "editing" ? paste.open : true,
    submitting: paste.status === "submitting",
  }
}

function poll(
  state: Extract<ProviderConnectState, { status: "starting" | "failed" }>,
  signIn: ProviderPolledSignIn,
): ProviderConnectTransition {
  const attempt = state.status === "starting" ? state.attempt : state.attempt + 1

  // A paste in flight when polling failed reports to the old attempt, so a resumed sign-in starts editable too.
  const next: ProviderPolledSignIn =
    signIn.kind === "browser" && signIn.authorization.paste
      ? {
          ...signIn,
          paste: {
            status: "editing",
            value: signIn.paste?.value ?? "",
            open: signIn.paste?.status === "editing" ? signIn.paste.open : signIn.paste ? true : undefined,
          },
        }
      : signIn

  return {
    state: { ...selection(state, attempt), status: "waiting", signIn: next },
    effects: [{ type: "poll", attempt, signIn: next, delay: false }],
  }
}

function refresh(state: Selection, signIn: ProviderSignIn): ProviderConnectTransition {
  const attempt = state.attempt + 1

  return {
    state: { ...selection(state, attempt), status: "refreshing", signIn },
    effects: [{ type: "refresh", attempt, method: signIn.method }],
  }
}

// Stops the work the state left running: its poll timer and any server attempt still open.
function cleanup(state: ProviderConnectState): ProviderConnectEffect[] {
  const signIn =
    state.status === "failed" && state.retry.type === "poll"
      ? state.retry.signIn
      : state.status === "waiting" || state.status === "entering" || state.status === "submitting"
        ? state.signIn
        : undefined

  const stop: ProviderConnectEffect[] = state.status === "waiting" ? [{ type: "poll.stop" }] : []

  if (signIn?.kind === "browser" || signIn?.kind === "code")
    return [...stop, { type: "cancel", target: "oauth", attemptID: signIn.authorization.attemptID }]

  if (signIn?.kind === "command")
    return [...stop, { type: "cancel", target: "command", attemptID: signIn.command.attemptID }]

  return stop
}

function savedElsewhere(state: ProviderConnectState, event: ProviderConnectEvent) {
  if (event.type === "submit.succeeded") return state.status !== "submitting" || state.attempt !== event.attempt

  if (event.type === "external.saved") return !startedHere(state, event.attempt, "external")

  if (event.type !== "polled" || event.outcome.status !== "complete") return false

  return state.status !== "waiting" || state.attempt !== event.attempt
}

function startedHere(state: ProviderConnectState, attempt: number, type: ProviderConnectMethod["type"]) {
  return (
    state.status === "starting" && state.attempt === attempt && state.catalog.methods[state.methodIndex]?.type === type
  )
}

function selection(state: Selection, attempt: number): Selection {
  return { attempt, catalog: state.catalog, methodIndex: state.methodIndex, answer: state.answer }
}

function unchanged(state: ProviderConnectState, effects: ReadonlyArray<ProviderConnectEffect> = []) {
  return { state, effects }
}
