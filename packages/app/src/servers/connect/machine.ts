import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerAuthMethods } from "@/runtime/server/health-machine"
import { isMixedContent } from "./browser"
import type { ConnectMethod } from "./method"
import { bareServerAddress, legacyPairingLink, pairingLink, serverAddress } from "./pairing"

/** A server that only signs in its own accounts: it never accepts the shared password. */
export function localOnlyAuth(methods: ServerAuthMethods | undefined) {
  return methods?.includes("local") === true && !methods.includes("password")
}

/**
 * A backstop for a transport that ignores its abort signal. Above the slowest real path: redeeming a pairing link
 * (5 s, then up to 6 s choosing an address) and two 30 s health checks (the edited address, then the paired one).
 */
export const SERVER_CONNECT_TIMEOUT_MS = 75_000

/** A wedged camera daemon can leave `enumerateDevices` pending; past this the scan button gives way to the hint. */
export const CAMERA_PROBE_TIMEOUT_MS = 3_000

/** What the page can tell about the camera before probing: nothing to show off the web, or a probe to run. */
export type ServerCameraSupport = "none" | "insecure" | "unavailable" | "probe"

export type ServerCameraState =
  /** Not the web app: the native apps pair by pasted link. */
  | { readonly status: "hidden" }
  /** A plain-HTTP page cannot open the camera. */
  | { readonly status: "insecure" }
  | { readonly status: "probing"; readonly attempt: number }
  | { readonly status: "available" }
  | { readonly status: "unavailable" }

/** The saved server an edit form started from, as it is now. */
export type ServerOriginal = {
  readonly url: string
  readonly displayName: string | undefined
  readonly password: string | undefined
  readonly unauthorized: boolean
}

/** What the form saves to: the connect screen, a new server, or an edited one. */
export type ServerConnectTarget =
  | { readonly kind: "connect"; readonly url: string | undefined; readonly methods?: ServerAuthMethods }
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly original: ServerOriginal }

export type ServerConnectDraft = {
  readonly method: ConnectMethod
  readonly link: string
  readonly url: string
  readonly name: string
  readonly username: string
  readonly password: string
  /** What the account form submits: signing in, or creating the account on the server's open registration. */
  readonly account: "signin" | "create"
}

export type ServerConnectField = "link" | "url" | "name" | "username" | "password" | "account"

export type ServerConnectError =
  | { readonly type: "link-invalid" }
  | { readonly type: "link-legacy" }
  | { readonly type: "address-invalid" }
  /** Already localized by `useRedeemPairing`. */
  | { readonly type: "redeem"; readonly message: string }
  | { readonly type: "connection-failed"; readonly url: string }
  /** The server rejected the credentials; its methods say which sign-ins it accepts. */
  | { readonly type: "credentials"; readonly methods: ServerAuthMethods }
  /** The server refused the account request, such as a weak password; the message is its own. */
  | { readonly type: "refused"; readonly message: string }
  | { readonly type: "username-taken" }

export type ServerSaveAction =
  | { readonly type: "connect"; readonly http: ServerConnection.HttpBase; readonly displayName: string | undefined }
  | { readonly type: "add"; readonly connection: ServerConnection.Http }
  | { readonly type: "replace"; readonly originalUrl: string; readonly connection: ServerConnection.Http }

type Form = {
  readonly attempt: number
  readonly cameraAttempt: number
  readonly camera: ServerCameraState
  readonly target: ServerConnectTarget
  readonly draft: ServerConnectDraft
  /** What the server's 401 advertised, once a check got that far; picks the credentials form's variant. */
  readonly methods: ServerAuthMethods | undefined
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
  | { readonly type: "camera.settled"; readonly attempt: number; readonly available: boolean }
  | { readonly type: "camera.timed-out"; readonly attempt: number }
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
  | {
      readonly type: "connect.local"
      readonly attempt: number
      readonly url: string
      readonly username: string
      readonly password: string
      readonly create: boolean
    }
  | { readonly type: "timer.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timer.stop" }
  /** Check for a camera, and dispatch `camera.timed-out` after `timeoutMs`. */
  | { readonly type: "camera.probe"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "camera.timer.stop" }
  | { readonly type: "save"; readonly action: ServerSaveAction }
  | { readonly type: "close"; readonly saved?: ServerConnection.Http }

export type ServerConnectTransition = {
  readonly state: ServerConnectState
  readonly effects: readonly ServerConnectEffect[]
}

export function startServerConnect(
  target: ServerConnectTarget,
  support: ServerCameraSupport = "none",
): ServerConnectTransition {
  // The health check may already know the server's 401, so the screen opens on the form that can sign in instead of
  // the pairing link a cold visit starts from.
  const methods = target.kind === "connect" ? target.methods : undefined
  const base = {
    status: "editing",
    attempt: 0,
    cameraAttempt: 0,
    target,
    draft: initialDraft(target),
    methods,
  } as const

  if (support === "probe")
    return {
      state: { ...base, cameraAttempt: 1, camera: { status: "probing", attempt: 1 } },
      effects: [probe(1)],
    }

  return { state: { ...base, camera: { status: support === "none" ? "hidden" : support } }, effects: [] }
}

export function transitionServerConnect(state: ServerConnectState, event: ServerConnectEvent): ServerConnectTransition {
  const same = { state, effects: [] }

  if (state.status === "closed") return same

  if (event.type === "disposed") return close(state, state.status === "submitting" ? [stop] : [])

  if (event.type === "original.synced") return synced(state, event.original)

  if (event.type === "camera.settled" || event.type === "camera.timed-out") {
    if (state.camera.status !== "probing" || state.camera.attempt !== event.attempt) return same
    const available = event.type === "camera.settled" && event.available

    return {
      state: { ...state, camera: { status: available ? "available" : "unavailable" } },
      effects: [{ type: "camera.timer.stop" }],
    }
  }

  if (state.status === "scanning") {
    // The scanner may have just been denied the camera, so it is checked again before Scan is offered.
    if (event.type === "scan.cancelled") {
      const cameraAttempt = state.cameraAttempt + 1

      return {
        state: {
          ...form(state),
          status: "editing",
          cameraAttempt,
          camera: { status: "probing", attempt: cameraAttempt },
        },
        effects: [probe(cameraAttempt)],
      }
    }

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
    // A 401 that announces nothing carries no new information about the server's methods, so it keeps the ones
    // already learned; erasing them would flip the account form back under the user.
    const methods =
      error.type === "credentials" && error.methods.length > 0 ? error.methods : state.methods

    // A 401 that advertises only local accounts redirects the shared-password form to them, once: those servers
    // never accept the password, so the form the user submitted cannot work.
    if (error.type === "credentials" && localOnlyAuth(methods) && !localOnlyAuth(state.methods))
      return {
        state: {
          ...form(state),
          methods,
          status: "editing",
          draft: { ...state.draft, password: "", account: "signin" },
        },
        effects: [stop],
      }

    return { state: { ...form(state), methods, status: "editing", error }, effects: [stop] }
  }

  if (event.type === "method.changed") {
    if (state.draft.method === event.method && !state.error) return same

    return { state: editing(state, { ...state.draft, method: event.method }), effects: [] }
  }

  if (event.type === "field.changed") {
    if (state.draft[event.field] === event.value && !state.error) return same

    return { state: editing(state, { ...state.draft, [event.field]: event.value }), effects: [] }
  }

  if (event.type === "scan.started") {
    if (state.camera.status !== "available") return same

    return { state: { ...form(state), status: "scanning" }, effects: [] }
  }

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
  | "server.connect.local.invalid"
  | "server.connect.local.taken"
  | "dialog.server.add.error"

export type ServerConnectViewKey =
  | ServerConnectErrorKey
  | "server.connect.camera.unavailable"
  | "server.connect.camera.native"

export type ServerConnectErrorContext = {
  readonly surface: "screen" | "dialog"
  /** Set on the web app, where an HTTPS page cannot reach a plain-HTTP address. */
  readonly pageHref: string | undefined
  readonly t: (key: ServerConnectViewKey) => string
  /** The credentials form signs in to the server's own accounts, so rejected credentials say so. */
  readonly localAuth?: boolean
}

export function formatServerConnectError(error: ServerConnectError, context: ServerConnectErrorContext) {
  if (error.type === "redeem") return error.message

  if (error.type === "refused") return error.message

  if (error.type === "link-invalid") return context.t("server.connect.link.invalid")

  if (error.type === "link-legacy") return context.t("server.connect.link.legacy")

  if (error.type === "address-invalid") return context.t("server.connect.address.invalid")

  if (error.type === "username-taken") return context.t("server.connect.local.taken")

  if (error.type === "credentials")
    return context.localAuth
      ? context.t("server.connect.local.invalid")
      : context.t(context.surface === "screen" ? "server.connect.failed" : "dialog.server.add.error")

  if (context.pageHref && isMixedContent(context.pageHref, error.url)) return context.t("server.connect.mixedContent")

  return context.t(context.surface === "screen" ? "server.connect.failed" : "dialog.server.add.error")
}

export function selectServerConnectView(state: ServerConnectState, context: ServerConnectErrorContext) {
  const link = state.draft.method === "link"
  const primary = link ? state.draft.link : state.draft.url
  const camera = state.camera.status
  // The credentials form becomes an account sign-in once the server's 401 advertised only those.
  const localAuth = !link && localOnlyAuth(state.methods)
  // The served screen signs in to the server that hosts it, so when that server only takes its own accounts the form
  // is just a sign-in: the address is already the page's origin and a pairing link has nothing to add.
  const direct = state.target.kind === "connect" && localOnlyAuth(state.methods)
  const settled = { ...context, localAuth }

  return {
    // Shown, disabled, while the camera check runs, so the hint does not flash in first.
    showScan: link && (camera === "available" || camera === "probing"),
    canScan: state.status === "editing" && link && camera === "available",
    cameraHint: link ? cameraHint(camera, context) : undefined,
    scanning: state.status === "scanning",
    busy: state.status === "submitting",
    disabled: state.status !== "editing",
    direct,
    localAuth,
    creating: localAuth && state.draft.account === "create",
    canSubmit:
      state.status === "editing" &&
      primary.trim().length > 0 &&
      (!localAuth || (state.draft.username.trim().length > 0 && state.draft.password.length > 0)),
    signedOut: state.target.kind === "edit" && state.target.original.unauthorized,
    draft: state.draft,
    error: state.status === "editing" && state.error ? formatServerConnectError(state.error, settled) : undefined,
  }
}

export type ServerConnectView = ReturnType<typeof selectServerConnectView>

// QR codes carry JSON, not a link, so on a plain-HTTP page the pasted link is the way in.
function cameraHint(camera: ServerCameraState["status"], context: ServerConnectErrorContext) {
  if (camera === "insecure") return context.t("server.connect.camera.native")

  if (camera === "unavailable") return context.t("server.connect.camera.unavailable")

  return undefined
}

const stop = { type: "timer.stop" } as const

function probe(attempt: number): ServerConnectEffect {
  return { type: "camera.probe", attempt, timeoutMs: CAMERA_PROBE_TIMEOUT_MS }
}

/** Closes the form, stopping a camera check that is still running. */
function close(state: Form, effects: readonly ServerConnectEffect[]): ServerConnectTransition {
  return {
    state: { ...form(state), status: "closed" },
    effects: state.camera.status === "probing" ? [...effects, { type: "camera.timer.stop" }] : effects,
  }
}

function initialDraft(target: ServerConnectTarget): ServerConnectDraft {
  if (target.kind !== "edit")
    return {
      // A server whose 401 already advertised only its own accounts opens on them; anything else starts at the
      // pairing link, the way in the pairing flow publishes.
      method: target.kind === "connect" && localOnlyAuth(target.methods) ? "password" : "link",
      link: "",
      url: target.kind === "connect" ? (target.url ?? "") : "",
      name: "",
      username: "",
      password: "",
      account: "signin",
    }

  // A signed-out server needs a new pairing link; otherwise editing starts from its address.
  return {
    method: target.original.unauthorized ? "link" : "password",
    link: "",
    url: target.original.url,
    name: target.original.displayName ?? "",
    username: "",
    password: target.original.password ?? "",
    account: "signin",
  }
}

function form(state: Form): Form {
  return {
    attempt: state.attempt,
    cameraAttempt: state.cameraAttempt,
    camera: state.camera,
    target: state.target,
    draft: state.draft,
    methods: state.methods,
  }
}

function editing(state: Form, draft: ServerConnectDraft, error?: ServerConnectError): ServerConnectState {
  return { ...form(state), status: "editing", draft, error }
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
      state: { ...form(state), status: "submitting", attempt, draft, fallbackUrl },
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

  // The server's 401 advertised only its own accounts, so this submits them instead of the shared password.
  if (localOnlyAuth(state.methods))
    return {
      state: { ...form(state), status: "submitting", attempt, draft, fallbackUrl: url },
      effects: [
        {
          type: "connect.local",
          attempt,
          url,
          username: draft.username,
          password: draft.password,
          create: draft.account === "create",
        },
        timer,
      ],
    }

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
    return close({ ...state, draft }, [{ type: "close" }])

  const http = password ? { url, password } : { url }

  return {
    state: { ...form(state), status: "submitting", attempt, draft, fallbackUrl: url },
    effects: [{ type: "connect.http", attempt, http }, timer],
  }
}

function saved(state: Form, http: ServerConnection.HttpBase): ServerConnectTransition {
  // A name the user typed wins over the one a pairing link carries.
  const displayName =
    state.draft.name.trim() || pairingLink(state.draft.method === "link" ? state.draft.link : state.draft.url)?.name

  if (state.target.kind === "connect")
    return {
      state: { ...form(state), status: "editing" },
      effects: [stop, { type: "save", action: { type: "connect", http, displayName } }],
    }

  const connection: ServerConnection.Http = { type: "http", displayName, http }
  const original = state.target.kind === "edit" ? state.target.original : undefined

  const action: ServerSaveAction =
    original && original.url !== http.url
      ? { type: "replace", originalUrl: original.url, connection }
      : { type: "add", connection }

  return close(state, [stop, { type: "save", action }, { type: "close", saved: connection }])
}

function synced(
  state: Exclude<ServerConnectState, { status: "closed" }>,
  original: ServerOriginal | undefined,
): ServerConnectTransition {
  if (state.target.kind !== "edit") return { state, effects: [] }

  // The edited server was removed elsewhere: there is nothing left to save to.
  if (!original) return close(state, [...(state.status === "submitting" ? [stop] : []), { type: "close" }])

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
