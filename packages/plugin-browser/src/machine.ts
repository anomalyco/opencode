export * as BrowserMachine from "./machine.js"

import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import type { Browser } from "./rpc.js"
import { BrowserSkill } from "./skill.js"

/** How long one permission sync (`session.get` and, when needed, `session.update`) may take. The desktop waits 15 s. */
export const PERMISSION_SYNC_TIMEOUT_MS = 10_000

/** How long a dispatched browser command may run before it times out and is cancelled on the desktop. */
export const REQUEST_TIMEOUT_MS = 60_000

/** The browser tools and their skill, which an attachment allows together. */
export const ACCESS = [
  { action: "browser", resource: "*" },
  { action: "skill", resource: BrowserSkill.id },
] as const

/** The one `session.permissions` sync in flight for a session: grant (`allow`) or revoke the browser rules. */
export type PermissionSync = { readonly attempt: number; readonly allow: boolean }

/**
 * One session's attachment. A session absent from `sessions` has no attachment and no sync in flight.
 *
 * - `attaching`: the desktop called `attach` as `attempt`. Its grant runs after any revoke in flight (`sync`); until it
 *   succeeds, no `attached` handshake is sent and no command is dispatched.
 * - `attached`: the session allows the browser and the desktop received `attached`; commands run.
 * - `revoking`: no attachment; `sync` settles, then a revoke follows unless the session was `deleted`.
 */
export type SessionState =
  | {
      readonly status: "attaching"
      readonly attempt: number
      readonly connectionID: string
      readonly sync: PermissionSync
    }
  | {
      readonly status: "attached"
      readonly attempt: number
      readonly connectionID: string
      readonly browserState: Browser.State
      readonly pending: ReadonlyMap<string, Browser.Command>
    }
  | { readonly status: "revoking"; readonly sync: PermissionSync; readonly deleted: boolean }

export type RevokingSession = Extract<SessionState, { readonly status: "revoking" }>

type AttachingSession = Extract<SessionState, { readonly status: "attaching" }>

type AttachedSession = Extract<SessionState, { readonly status: "attached" }>

/** Every attachment of the plugin. Once `disposed`, only revokes still draining remain. */
export type ConnectionState =
  | {
      readonly status: "active"
      readonly nextAttempt: number
      readonly sessions: ReadonlyMap<Session.ID, SessionState>
    }
  | {
      readonly status: "disposed"
      readonly nextAttempt: number
      readonly sessions: ReadonlyMap<Session.ID, RevokingSession>
    }

/** How an `attach` call ends: its result, or `unavailable` when the grant failed. */
export type AttachmentOutcome = "closed" | "replaced" | "unavailable"

export type RequestSettlement =
  | { readonly ok: true; readonly result: Browser.Result }
  | { readonly ok: false; readonly error: Tool.Error }

export type ConnectionEvent =
  /** `attempt` is the state's `nextAttempt`, read when the driver registered the attachment's handle. */
  | {
      readonly type: "attach.started"
      readonly sessionID: Session.ID
      readonly attempt: number
      readonly connectionID: string
    }
  /** The `attach` call ended on the desktop's side (disconnect or interrupt). */
  | { readonly type: "attach.closed"; readonly sessionID: Session.ID; readonly attempt: number }
  | { readonly type: "permissions.synced"; readonly sessionID: Session.ID; readonly attempt: number }
  | {
      readonly type: "permissions.failed"
      readonly sessionID: Session.ID
      readonly attempt: number
      readonly error: unknown
    }
  | { readonly type: "permissions.timed-out"; readonly sessionID: Session.ID; readonly attempt: number }
  | {
      readonly type: "state.updated"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly browserState: Browser.State
    }
  | {
      readonly type: "request.started"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
      readonly command: Browser.Command
    }
  | {
      readonly type: "request.dispatch-failed"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
      readonly error: unknown
    }
  | {
      readonly type: "request.settled"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
      readonly outcome: Browser.Outcome
    }
  | {
      readonly type: "request.timed-out"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
    }
  /** The tool call that started the request was interrupted. */
  | {
      readonly type: "request.cancelled"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
    }
  | { readonly type: "session.moved"; readonly sessionID: Session.ID }
  | { readonly type: "session.deleted"; readonly sessionID: Session.ID }
  | { readonly type: "disposed" }

export type ConnectionEffect =
  | {
      readonly type: "sync-permissions"
      readonly sessionID: Session.ID
      readonly attempt: number
      readonly allow: boolean
    }
  /** Disposes the attachment's tunnels and ends its `attach` call with `outcome`. */
  | { readonly type: "close-attachment"; readonly attempt: number; readonly outcome: AttachmentOutcome }
  | { readonly type: "emit-control"; readonly control: Browser.Control }
  /** Emits the `command` control; a failure comes back as `request.dispatch-failed`. */
  | {
      readonly type: "dispatch-command"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
    }
  | { readonly type: "settle-request"; readonly requestID: string; readonly settlement: RequestSettlement }
  | { readonly type: "warn"; readonly message: string; readonly error: unknown }
  /** The disposed plugin has no revoke left in flight. */
  | { readonly type: "notify-drained" }

export type ConnectionTransition = { readonly state: ConnectionState; readonly effects: readonly ConnectionEffect[] }

type SessionEvent = Exclude<ConnectionEvent, { readonly type: "disposed" }>

type Step<S extends SessionState> = {
  readonly entry: S | undefined
  readonly nextAttempt: number
  readonly effects: readonly ConnectionEffect[]
}

export function createConnectionState(): ConnectionState {
  return { status: "active", nextAttempt: 1, sessions: new Map() }
}

export function transitionConnection(state: ConnectionState, event: ConnectionEvent): ConnectionTransition {
  if (event.type === "disposed") return dispose(state)

  // A request whose attachment closed or was replaced after the tool picked it was never sent.
  if (event.type === "request.started" && !isAttachedConnection(state, event.sessionID, event.connectionID))
    return {
      state,
      effects: [
        {
          type: "settle-request",
          requestID: event.requestID,
          settlement: { ok: false, error: disconnectedBeforeDispatch() },
        },
      ],
    }

  const entry = state.sessions.get(event.sessionID)

  if (state.status === "disposed") {
    if (!entry || entry.status !== "revoking") return { state, effects: [] }
    const step = transitionRevoking(entry, event, state.nextAttempt)

    if (!step) return { state, effects: [] }
    const sessions = new Map(state.sessions)

    if (step.entry) sessions.set(event.sessionID, step.entry)

    if (!step.entry) sessions.delete(event.sessionID)

    return {
      state: { status: "disposed", nextAttempt: step.nextAttempt, sessions },
      effects: sessions.size ? step.effects : [...step.effects, { type: "notify-drained" }],
    }
  }

  const step = transitionSession(entry, event, state.nextAttempt)

  if (!step) return { state, effects: [] }
  const sessions = new Map(state.sessions)

  if (step.entry) sessions.set(event.sessionID, step.entry)

  if (!step.entry) sessions.delete(event.sessionID)

  return { state: { status: "active", nextAttempt: step.nextAttempt, sessions }, effects: step.effects }
}

function transitionSession(
  entry: SessionState | undefined,
  event: SessionEvent,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (event.type === "attach.started") return attach(entry, event, nextAttempt)

  if (!entry) return undefined

  if (entry.status === "revoking") return transitionRevoking(entry, event, nextAttempt)

  if (entry.status === "attaching") return transitionAttaching(entry, event, nextAttempt)

  return transitionAttached(entry, event, nextAttempt)
}

function attach(
  entry: SessionState | undefined,
  event: Extract<SessionEvent, { readonly type: "attach.started" }>,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (event.attempt !== nextAttempt) return undefined
  const attaching = (sync: PermissionSync): AttachingSession => ({
    status: "attaching",
    attempt: event.attempt,
    connectionID: event.connectionID,
    sync,
  })

  // A sync already in flight finishes first; the grant waits for it, so two writes never interleave.
  if (entry?.status === "attaching")
    return {
      entry: attaching(entry.sync),
      nextAttempt: nextAttempt + 1,
      effects: [{ type: "close-attachment", attempt: entry.attempt, outcome: "replaced" }],
    }

  if (entry?.status === "revoking") return { entry: attaching(entry.sync), nextAttempt: nextAttempt + 1, effects: [] }
  const sync = { attempt: nextAttempt + 1, allow: true }
  const effects: ConnectionEffect[] =
    entry?.status === "attached"
      ? [...failPending(entry), { type: "close-attachment", attempt: entry.attempt, outcome: "replaced" }]
      : []

  return {
    entry: attaching(sync),
    nextAttempt: nextAttempt + 2,
    effects: [...effects, { type: "sync-permissions", sessionID: event.sessionID, ...sync }],
  }
}

function transitionAttaching(
  entry: AttachingSession,
  event: SessionEvent,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (
    event.type === "permissions.synced" ||
    event.type === "permissions.failed" ||
    event.type === "permissions.timed-out"
  ) {
    if (event.attempt !== entry.sync.attempt) return undefined
    const warning = syncWarning(event, entry.sync)

    // The revoke that ran before this attachment settled; now grant.
    if (!entry.sync.allow) {
      const sync = { attempt: nextAttempt, allow: true }

      return {
        entry: { ...entry, sync },
        nextAttempt: nextAttempt + 1,
        effects: [...warning, { type: "sync-permissions", sessionID: event.sessionID, ...sync }],
      }
    }

    if (event.type === "permissions.synced")
      return {
        entry: {
          status: "attached",
          attempt: entry.attempt,
          connectionID: entry.connectionID,
          browserState: { tabs: [], focusedTabID: null },
          pending: new Map(),
        },
        nextAttempt,
        effects: [
          { type: "emit-control", control: { type: "attached", connectionID: entry.connectionID, version: 4 } },
        ],
      }
    // A grant that timed out may still have written its rules; revoke them.
    const sync = { attempt: nextAttempt, allow: false }

    return {
      entry: { status: "revoking", sync, deleted: false },
      nextAttempt: nextAttempt + 1,
      effects: [
        ...warning,
        { type: "close-attachment", attempt: entry.attempt, outcome: "unavailable" },
        { type: "sync-permissions", sessionID: event.sessionID, ...sync },
      ],
    }
  }

  if (
    (event.type === "attach.closed" && event.attempt === entry.attempt) ||
    event.type === "session.moved" ||
    event.type === "session.deleted"
  )
    return {
      entry: { status: "revoking", sync: entry.sync, deleted: event.type === "session.deleted" },
      nextAttempt,
      effects: [{ type: "close-attachment", attempt: entry.attempt, outcome: "closed" }],
    }

  return undefined
}

function transitionAttached(
  entry: AttachedSession,
  event: SessionEvent,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (event.type === "state.updated") return updateBrowserState(entry, event, nextAttempt)

  if (event.type === "request.started") {
    if (entry.pending.has(event.requestID)) return undefined

    return {
      entry: { ...entry, pending: new Map(entry.pending).set(event.requestID, event.command) },
      nextAttempt,
      effects: [
        {
          type: "dispatch-command",
          sessionID: event.sessionID,
          connectionID: entry.connectionID,
          requestID: event.requestID,
        },
      ],
    }
  }

  if (
    event.type === "request.dispatch-failed" ||
    event.type === "request.settled" ||
    event.type === "request.timed-out" ||
    event.type === "request.cancelled"
  ) {
    const command = entry.connectionID === event.connectionID ? entry.pending.get(event.requestID) : undefined

    if (!command) return undefined
    const pending = new Map(entry.pending)
    pending.delete(event.requestID)

    return { entry: { ...entry, pending }, nextAttempt, effects: settleRequest(entry, event, command) }
  }

  if (event.type === "session.deleted")
    return {
      entry: undefined,
      nextAttempt,
      effects: [...failPending(entry), { type: "close-attachment", attempt: entry.attempt, outcome: "closed" }],
    }

  if ((event.type === "attach.closed" && event.attempt === entry.attempt) || event.type === "session.moved")
    return revokeAttached(entry, event.sessionID, nextAttempt)

  return undefined
}

function transitionRevoking(
  entry: RevokingSession,
  event: SessionEvent,
  nextAttempt: number,
): Step<RevokingSession> | undefined {
  if (event.type === "session.deleted")
    return entry.deleted ? undefined : { entry: { ...entry, deleted: true }, nextAttempt, effects: [] }

  if (
    event.type !== "permissions.synced" &&
    event.type !== "permissions.failed" &&
    event.type !== "permissions.timed-out"
  )
    return undefined

  if (event.attempt !== entry.sync.attempt) return undefined
  const warning = syncWarning(event, entry.sync)

  // A grant settled after its attachment closed, or timed out and may still have written: revoke it.
  if (entry.sync.allow && !entry.deleted) {
    const sync = { attempt: nextAttempt, allow: false }

    return {
      entry: { status: "revoking", sync, deleted: false },
      nextAttempt: nextAttempt + 1,
      effects: [...warning, { type: "sync-permissions", sessionID: event.sessionID, ...sync }],
    }
  }

  return { entry: undefined, nextAttempt, effects: warning }
}

function dispose(state: ConnectionState): ConnectionTransition {
  if (state.status === "disposed") return { state, effects: [] }
  const effects: ConnectionEffect[] = []
  const sessions = new Map<Session.ID, RevokingSession>()
  const nextAttempt = Array.from(state.sessions).reduce((attempt, [sessionID, entry]) => {
    if (entry.status === "revoking") {
      sessions.set(sessionID, entry)

      return attempt
    }

    if (entry.status === "attaching") {
      sessions.set(sessionID, { status: "revoking", sync: entry.sync, deleted: false })
      effects.push({ type: "close-attachment", attempt: entry.attempt, outcome: "closed" })

      return attempt
    }
    const step = revokeAttached(entry, sessionID, attempt)

    if (step.entry) sessions.set(sessionID, step.entry)
    effects.push(...step.effects)

    return step.nextAttempt
  }, state.nextAttempt)

  if (!sessions.size) effects.push({ type: "notify-drained" })

  return { state: { status: "disposed", nextAttempt, sessions }, effects }
}

function revokeAttached(entry: AttachedSession, sessionID: Session.ID, nextAttempt: number): Step<RevokingSession> {
  const sync = { attempt: nextAttempt, allow: false }

  return {
    entry: { status: "revoking", sync, deleted: false },
    nextAttempt: nextAttempt + 1,
    effects: [
      ...failPending(entry),
      { type: "close-attachment", attempt: entry.attempt, outcome: "closed" },
      { type: "sync-permissions", sessionID, ...sync },
    ],
  }
}

function updateBrowserState(
  entry: AttachedSession,
  event: Extract<SessionEvent, { readonly type: "state.updated" }>,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (entry.connectionID !== event.connectionID || entry.browserState === event.browserState) return undefined

  return { entry: { ...entry, browserState: event.browserState }, nextAttempt, effects: [] }
}

function settleRequest(
  entry: AttachedSession,
  event: Extract<
    SessionEvent,
    { readonly type: "request.dispatch-failed" | "request.settled" | "request.timed-out" | "request.cancelled" }
  >,
  command: Browser.Command,
): ConnectionEffect[] {
  const cancel: ConnectionEffect = {
    type: "emit-control",
    control: { type: "cancel", connectionID: entry.connectionID, requestID: event.requestID },
  }

  // The interrupted caller no longer waits; only the desktop needs to stop.
  if (event.type === "request.cancelled") return [cancel]
  const settle = (settlement: RequestSettlement): ConnectionEffect => ({
    type: "settle-request",
    requestID: event.requestID,
    settlement,
  })

  if (event.type === "request.timed-out") return [settle({ ok: false, error: timedOut(command.action.type) }), cancel]

  if (event.type === "request.dispatch-failed")
    return [settle({ ok: false, error: dispatchFailed(command.action.type, event.error) })]

  if (event.outcome.type === "success") return [settle({ ok: true, result: event.outcome.result })]

  return [
    settle({
      ok: false,
      error: new Tool.Error({ message: `[browser.${event.outcome.code}] ${event.outcome.message}` }),
    }),
  ]
}

function failPending(entry: AttachedSession): ConnectionEffect[] {
  return Array.from(entry.pending.keys(), (requestID) => ({
    type: "settle-request",
    requestID,
    settlement: { ok: false, error: disconnectedAfterDispatch() },
  }))
}

function syncWarning(
  event: Extract<
    SessionEvent,
    { readonly type: "permissions.synced" | "permissions.failed" | "permissions.timed-out" }
  >,
  sync: PermissionSync,
): ConnectionEffect[] {
  const action = sync.allow ? "grant" : "revoke"

  if (event.type === "permissions.failed")
    return [{ type: "warn", message: `Browser permission ${action} failed`, error: event.error }]

  if (event.type === "permissions.timed-out")
    return [
      {
        type: "warn",
        message: `Browser permission ${action} timed out after ${PERMISSION_SYNC_TIMEOUT_MS} ms`,
        error: undefined,
      },
    ]

  return []
}

/**
 * The session's permissions with exactly one set of browser allows (`allow`) or none, every other rule kept in order.
 * Undefined when they already are, so a replace writes nothing.
 */
export function reconcileBrowserPermissions(
  current: readonly Permission.Rule[] | undefined,
  allow: boolean,
): Permission.Rule[] | undefined {
  const rules = current ?? []
  const kept = rules.filter(
    (rule) =>
      rule.effect !== "allow" ||
      !ACCESS.some((access) => access.action === rule.action && access.resource === rule.resource),
  )
  const next = allow ? [...kept, ...ACCESS.map((rule) => ({ ...rule, effect: "allow" as const }))] : kept
  const unchanged =
    next.length === rules.length &&
    next.every(
      (rule, index) =>
        rule.action === rules[index]?.action &&
        rule.resource === rules[index]?.resource &&
        rule.effect === rules[index]?.effect,
    )

  return unchanged ? undefined : next
}

export function isConnectionDisposed(state: ConnectionState) {
  return state.status === "disposed"
}

/** The attempt the next `attach` gets; the driver keys its handle by it before dispatching `attach.started`. */
export function selectNextAttempt(state: ConnectionState) {
  return state.nextAttempt
}

/** The attempt of the session's attachment with `connectionID`, attaching or attached. */
export function selectAttachment(state: ConnectionState, sessionID: Session.ID, connectionID: string) {
  if (state.status === "disposed") return undefined
  const entry = state.sessions.get(sessionID)

  if (entry?.status === "revoking" || entry?.connectionID !== connectionID) return undefined

  return entry.attempt
}

export function isAttachedConnection(state: ConnectionState, sessionID: Session.ID, connectionID: string) {
  if (state.status === "disposed") return false
  const entry = state.sessions.get(sessionID)

  return entry?.status === "attached" && entry.connectionID === connectionID
}

export function selectPendingCommand(
  state: ConnectionState,
  sessionID: Session.ID,
  connectionID: string,
  requestID: string,
) {
  if (state.status === "disposed") return undefined
  const entry = state.sessions.get(sessionID)

  if (entry?.status !== "attached" || entry.connectionID !== connectionID) return undefined

  return entry.pending.get(requestID)
}

/** The attachment and tab a browser tool call targets, or the error the tool returns. */
export function selectTarget(
  state: ConnectionState,
  sessionID: Session.ID,
  action: Browser.Action,
):
  | { readonly ok: true; readonly connectionID: string; readonly tab: Browser.Tab | undefined }
  | { readonly ok: false; readonly error: Tool.Error } {
  const entry = state.status === "active" ? state.sessions.get(sessionID) : undefined

  if (!entry || entry.status === "revoking")
    return {
      ok: false,
      error: new Tool.Error({
        message:
          "[browser.disconnected] No desktop browser is connected to this session. Open this session in the desktop app and wait for it to connect. Then call browser.tabs.list({}). Repeating browser actions while disconnected will not help.",
      }),
    }

  if (entry.status === "attaching")
    return {
      ok: false,
      error: new Tool.Error({
        message:
          "[browser.disconnected] The desktop browser is still connecting to this session; no action ran. Call browser.tabs.list({}) once it finishes connecting.",
      }),
    }
  const tab = "tabID" in action ? entry.browserState.tabs.find((tab) => tab.id === action.tabID) : undefined

  if ("tabID" in action && !tab)
    return {
      ok: false,
      error: new Tool.Error({
        message:
          "[browser.tab_unavailable] This tab is closed or does not belong to the connected session. Call browser.tabs.list({}) and use an exact returned tabID. If no tabs exist, use browser.tabs.open({}). Never substitute a request ID, file ID, or element ref for tabID.",
      }),
    }

  return { ok: true, connectionID: entry.connectionID, tab }
}

function disconnectedBeforeDispatch() {
  return new Tool.Error({
    message:
      "[browser.disconnected] The desktop browser disconnected before this action was sent; no action ran. Reconnect this session in the desktop app, then call browser.tabs.list({}).",
  })
}

function disconnectedAfterDispatch() {
  return new Tool.Error({
    message:
      "[browser.disconnected] Browser connection closed; the action may already have run. Reconnect this session in the desktop app, call browser.tabs.list({}), and inspect the target tab with browser.snapshot({tabID}). Do not repeat clicks, submissions, uploads, or evaluations until their outcome is known.",
  })
}

function dispatchFailed(action: Browser.Method, error: unknown) {
  return new Tool.Error({
    message: `Could not dispatch browser.${action}. Check the desktop connection and call browser.tabs.list({}) before deciding whether to retry.`,
    error,
  })
}

function timedOut(action: Browser.Method) {
  return new Tool.Error({
    message: `[browser.timeout] browser.${action} did not finish within ${REQUEST_TIMEOUT_MS / 1000} seconds; its outcome is unknown. Check the desktop connection, call browser.tabs.list({}), and inspect the tab or browser.files.list({tabID}) for completed work. Do not blindly repeat a mutating action or start another recording.`,
  })
}
