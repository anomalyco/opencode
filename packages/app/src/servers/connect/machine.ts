import type { ServerConnection } from "@/runtime/server/registry"
import { isMixedContent } from "./browser"
import type { ConnectMethod } from "./method"
import { bareServerAddress, legacyPairingLink, pairingLink, serverAddress } from "./pairing"

/**
 * A backstop for a transport that ignores its abort signal. Above the slowest real path: redeeming a pairing link
 * (5 s, then up to 6 s choosing an address) and two 30 s health checks (the edited address, then the paired one).
 */
export const SERVER_CONNECT_TIMEOUT_MS = 75_000

/** The saved server an edit form started from, as it is now. */
export type ServerOriginal = {
  readonly url: string
  readonly displayName: string | undefined
  readonly password: string | undefined
  readonly unauthorized: boolean
}

/** What the form saves to: the connect screen, a new server, or an edited one. */
export type ServerConnectTarget =
  | { readonly kind: "connect"; readonly url: string | undefined }
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly original: ServerOriginal }

export type ServerConnectDraft = {
  readonly method: ConnectMethod
  readonly link: string
  readonly url: string
  readonly name: string
  readonly password: string
}

export type ServerConnectField = "link" | "url" | "name" | "password"

export type ServerConnectError =
  | { readonly type: "link-invalid" }
  | { readonly type: "link-legacy" }
  | { readonly type: "address-invalid" }
  /** Already localized by `useRedeemPairing`. */
  | { readonly type: "redeem"; readonly message: string }
  | { readonly type: "connection-failed"; readonly url: string }

export type ServerSaveAction =
  | { readonly type: "connect"; readonly http: ServerConnection.HttpBase }
  | { readonly type: "add"; readonly connection: ServerConnection.Http }
  | { readonly type: "replace"; readonly originalUrl: string; readonly connection: ServerConnection.Http }

type Form = {
  readonly attempt: number
  readonly target: ServerConnectTarget
  readonly draft: ServerConnectDraft
}

/**
 * `submitting` carries the attempt its results must match. `closed` keeps the draft so the dialog shows its values
 * while it animates out, and ignores every later event, so the form closes at most once.
 */
export type ServerConnectState =
  | (Form & { readonly status: "editing"; readonly error?: ServerConnectError })
  | (Form & { readonly status: "scanning" })
  | (Form & {
      readonly status: "submitting"
      /** The address a timeout reports, to tell a blocked plain-HTTP address from an unreachable one. */
      readonly fallbackUrl: string
    })
  | (Form & { readonly status: "closed" })

export type ServerConnectEvent =
  | { readonly type: "method.changed"; readonly method: ConnectMethod }
  | { readonly type: "field.changed"; readonly field: ServerConnectField; readonly value: string }
  | { readonly type: "scan.started" }
  | { readonly type: "scan.cancelled" }
  | { readonly type: "scan.completed"; readonly link: string }
  | { readonly type: "submitted" }
  | { readonly type: "submit.succeeded"; readonly attempt: number; readonly http: ServerConnection.HttpBase }
  | { readonly type: "submit.failed"; readonly attempt: number; readonly error: ServerConnectError }
  | { readonly type: "submit.timed-out"; readonly attempt: number }
  /** The edited server as the registry lists it now; undefined once it is removed. */
  | { readonly type: "original.synced"; readonly original: ServerOriginal | undefined }
  | { readonly type: "disposed" }

export type ServerConnectEffect =
  | {
      readonly type: "connect.link"
      readonly attempt: number
      readonly link: string
      /** A pairing token works on every address of its server, so signing in again keeps this one when it answers. */
      readonly preferredUrl: string | undefined
      readonly fallbackUrl: string
    }
  | { readonly type: "connect.http"; readonly attempt: number; readonly http: ServerConnection.HttpBase }
  | { readonly type: "timer.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timer.stop" }
  | { readonly type: "save"; readonly action: ServerSaveAction }
  | { readonly type: "close"; readonly saved?: ServerConnection.Http }

export type ServerConnectTransition = {
  readonly state: ServerConnectState
  readonly effects: readonly ServerConnectEffect[]
}

export function createServerConnectState(target: ServerConnectTarget): ServerConnectState {
  return { status: "editing", attempt: 0, target, draft: initialDraft(target) }
}

export function transitionServerConnect(state: ServerConnectState, event: ServerConnectEvent): ServerConnectTransition {
  const same = { state, effects: [] }

  if (state.status === "closed") return same

  if (event.type === "disposed")
    return { state: { ...form(state), status: "closed" }, effects: state.status === "submitting" ? [stop] : [] }

  if (event.type === "original.synced") return synced(state, event.original)

  if (state.status === "scanning") {
    if (event.type === "scan.cancelled") return { state: { ...form(state), status: "editing" }, effects: [] }

    if (event.type === "scan.completed") return submit(state, { ...state.draft, method: "link", link: event.link })

    return same
  }

  if (state.status === "submitting") {
    if (
      (event.type !== "submit.succeeded" && event.type !== "submit.failed" && event.type !== "submit.timed-out") ||
      event.attempt !== state.attempt
    )
      return same

    if (event.type === "submit.succeeded") return saved(state, event.http)

    const error: ServerConnectError =
      event.type === "submit.failed" ? event.error : { type: "connection-failed", url: state.fallbackUrl }

    return { state: { ...form(state), status: "editing", error }, effects: [stop] }
  }

  if (event.type === "method.changed") {
    if (state.draft.method === event.method && !state.error) return same

    return { state: editing(state, { ...state.draft, method: event.method }), effects: [] }
  }

  if (event.type === "field.changed") {
    if (state.draft[event.field] === event.value && !state.error) return same

    return { state: editing(state, { ...state.draft, [event.field]: event.value }), effects: [] }
  }

  if (event.type === "scan.started") return { state: { ...form(state), status: "scanning" }, effects: [] }

  if (event.type === "submitted") return submit(state, state.draft)

  return same
}

/** The i18n keys a connect error can show; a redeem error carries its own text. */
export type ServerConnectErrorKey =
  | "server.connect.link.invalid"
  | "server.connect.link.legacy"
  | "server.connect.address.invalid"
  | "server.connect.mixedContent"
  | "server.connect.failed"
  | "dialog.server.add.error"

export type ServerConnectErrorContext = {
  readonly surface: "screen" | "dialog"
  /** Set on the web app, where an HTTPS page cannot reach a plain-HTTP address. */
  readonly pageHref: string | undefined
  readonly t: (key: ServerConnectErrorKey) => string
}

export function formatServerConnectError(error: ServerConnectError, context: ServerConnectErrorContext) {
  if (error.type === "redeem") return error.message

  if (error.type === "link-invalid") return context.t("server.connect.link.invalid")

  if (error.type === "link-legacy") return context.t("server.connect.link.legacy")

  if (error.type === "address-invalid") return context.t("server.connect.address.invalid")

  if (context.pageHref && isMixedContent(context.pageHref, error.url)) return context.t("server.connect.mixedContent")

  return context.t(context.surface === "screen" ? "server.connect.failed" : "dialog.server.add.error")
}

export function selectServerConnectView(state: ServerConnectState, context: ServerConnectErrorContext) {
  const primary = state.draft.method === "link" ? state.draft.link : state.draft.url

  return {
    scanning: state.status === "scanning",
    busy: state.status === "submitting",
    disabled: state.status !== "editing",
    canSubmit: state.status === "editing" && primary.trim().length > 0,
    signedOut: state.target.kind === "edit" && state.target.original.unauthorized,
    draft: state.draft,
    error: state.status === "editing" && state.error ? formatServerConnectError(state.error, context) : undefined,
  }
}

export type ServerConnectView = ReturnType<typeof selectServerConnectView>

const stop = { type: "timer.stop" } as const

function initialDraft(target: ServerConnectTarget): ServerConnectDraft {
  if (target.kind !== "edit")
    return {
      method: "link",
      link: "",
      url: target.kind === "connect" ? (target.url ?? "") : "",
      name: "",
      password: "",
    }

  // A signed-out server needs a new pairing link; otherwise editing starts from its address.
  return {
    method: target.original.unauthorized ? "link" : "password",
    link: "",
    url: target.original.url,
    name: target.original.displayName ?? "",
    password: target.original.password ?? "",
  }
}

function form(state: Form): Form {
  return { attempt: state.attempt, target: state.target, draft: state.draft }
}

function editing(state: Form, draft: ServerConnectDraft, error?: ServerConnectError): ServerConnectState {
  return { status: "editing", attempt: state.attempt, target: state.target, draft, error }
}

// Where the form points: a pasted or scanned pairing link wins, in either field; else the address and password.
function submit(state: Form, draft: ServerConnectDraft): ServerConnectTransition {
  const value = draft.method === "link" ? draft.link : draft.url
  const link = pairingLink(value)
  const attempt = state.attempt + 1
  const timer = { type: "timer.start", attempt, timeoutMs: SERVER_CONNECT_TIMEOUT_MS } as const
  const original = state.target.kind === "edit" ? state.target.original : undefined

  if (link) {
    const preferredUrl = original?.url ?? (state.target.kind === "connect" ? state.target.url : undefined)
    const fallbackUrl = preferredUrl ?? link.urls[0] ?? value

    return {
      state: { status: "submitting", attempt, target: state.target, draft, fallbackUrl },
      effects: [{ type: "connect.link", attempt, link: value, preferredUrl, fallbackUrl }, timer],
    }
  }

  if (legacyPairingLink(value)) return { state: editing(state, draft, { type: "link-legacy" }), effects: [] }

  if (draft.method === "link") {
    const address = bareServerAddress(value)

    if (!address) return { state: editing(state, draft, { type: "link-invalid" }), effects: [] }

    // A server address typed here belongs to the password form.
    return { state: editing(state, { ...draft, method: "password", link: "", url: address }), effects: [] }
  }

  const url = serverAddress(value)

  if (!url) return { state: editing(state, draft, { type: "address-invalid" }), effects: [] }
  const password = draft.password || undefined

  // Nothing changed: close, unless the server rejects these credentials, so saving checks them and the action that
  // asked for sign-in can continue.
  if (
    original &&
    !original.unauthorized &&
    url === original.url &&
    (draft.name.trim() || undefined) === original.displayName &&
    password === original.password
  )
    return { state: { ...form(state), draft, status: "closed" }, effects: [{ type: "close" }] }

  const http = password ? { url, password } : { url }

  return {
    state: { status: "submitting", attempt, target: state.target, draft, fallbackUrl: url },
    effects: [{ type: "connect.http", attempt, http }, timer],
  }
}

function saved(state: Form, http: ServerConnection.HttpBase): ServerConnectTransition {
  if (state.target.kind === "connect")
    return {
      state: { ...form(state), status: "editing" },
      effects: [stop, { type: "save", action: { type: "connect", http } }],
    }

  const connection: ServerConnection.Http = { type: "http", displayName: state.draft.name.trim() || undefined, http }
  const original = state.target.kind === "edit" ? state.target.original : undefined

  const action: ServerSaveAction =
    original && original.url !== http.url
      ? { type: "replace", originalUrl: original.url, connection }
      : { type: "add", connection }

  return {
    state: { ...form(state), status: "closed" },
    effects: [stop, { type: "save", action }, { type: "close", saved: connection }],
  }
}

function synced(
  state: Exclude<ServerConnectState, { status: "closed" }>,
  original: ServerOriginal | undefined,
): ServerConnectTransition {
  if (state.target.kind !== "edit") return { state, effects: [] }

  // The edited server was removed elsewhere: there is nothing left to save to.
  if (!original)
    return {
      state: { ...form(state), status: "closed" },
      effects: [...(state.status === "submitting" ? [stop] : []), { type: "close" }],
    }

  const current = state.target.original

  if (
    current.url === original.url &&
    current.displayName === original.displayName &&
    current.password === original.password &&
    current.unauthorized === original.unauthorized
  )
    return { state, effects: [] }

  return { state: { ...state, target: { kind: "edit", original } }, effects: [] }
}
