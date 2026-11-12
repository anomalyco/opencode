export * as BrowserConnection from "./connection.js"

import { hostname } from "node:os"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { RpcRegistration } from "@opencode/plugin/effect/rpc"
import { Location } from "@opencode/schema/location"
import type { Permission } from "@opencode/schema/permission"
import { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Cause, Deferred, Duration, Effect, Exit, Option, Schema, Scope, Semaphore, Stream } from "effect"
import { BrowserMachine } from "./machine.js"
import { Browser } from "./rpc.js"
import { BrowserTunnel } from "./tunnel.js"

type Attachment = {
  readonly closed: Deferred.Deferred<"closed" | "replaced", "unavailable">
  readonly tunnels: BrowserTunnel.Tunnels
}

export type Connection = Effect.Success<ReturnType<typeof make>>

/** The server process that wrote a session's grant, stored as `grant:<sessionID>` until its revoke succeeds. */
const GrantOwner = Schema.Struct({ host: Schema.String, pid: Schema.Number, location: Location.Ref })

const GRANT_PREFIX = "grant:"

/**
 * A crash or SIGKILL skips the revokes, so a session keeps its grant with no attachment behind it. Revokes the grants
 * this location's servers recorded, except those of a process that still runs: several servers can share one
 * database, and another one's attachment may be live. Runs before the RPC registers, so no attach here can race it.
 */
export const reconcileStaleGrants = Effect.fn("BrowserConnection.reconcileStaleGrants")(function* (ctx: {
  readonly session: Pick<Context["session"], "get" | "update">
  readonly storage: Pick<Context["storage"], "scan" | "remove">
  readonly location: Pick<Context["location"], "directory" | "workspaceID">
}) {
  const revoke = (entry: { readonly key: string; readonly value: Schema.Json }) => {
    const owner = Schema.decodeUnknownOption(GrantOwner)(entry.value)
    if (
      Option.isNone(owner) ||
      owner.value.location.directory !== ctx.location.directory ||
      owner.value.location.workspaceID !== ctx.location.workspaceID ||
      running(owner.value)
    )
      return Effect.void
    return writePermissions(ctx, Session.ID.make(entry.key.slice(GRANT_PREFIX.length)), false).pipe(
      Effect.ignore,
      Effect.andThen(ctx.storage.remove(entry.key)),
    )
  }
  const page = (after?: string): Effect.Effect<void> =>
    ctx.storage
      .scan({ prefix: GRANT_PREFIX, after })
      .pipe(
        Effect.flatMap((result) =>
          Effect.forEach(result.entries, revoke, { discard: true }).pipe(
            Effect.andThen(result.next === undefined ? Effect.void : page(result.next)),
          ),
        ),
      )
  yield* page()
})

export const make = Effect.fn("BrowserConnection.make")(function* (
  ctx: Pick<Context, "agent" | "rpc" | "session" | "location" | "event" | "permission" | "storage">,
) {
  // Each agent's rules from config and its definition, which an attachment's grant must not override.
  const configured = new Map<string, readonly Permission.Rule[]>()
  // Appended after config, so every agent hides the browser until an attachment allows it.
  yield* ctx.agent.transform((editor) => {
    configured.clear()
    editor.list().forEach((agent) => {
      configured.set(agent.id, [...agent.permissions])
      agent.permissions.push(...BrowserMachine.ACCESS.map((rule) => ({ ...rule, effect: "deny" as const })))
    })
  })
  const rulesFor = (session: Pick<Session.Info, "agent" | "permissions">, agent: string | undefined) => [
    ...(configured.get(agent ?? session.agent ?? "") ?? []),
    ...(session.permissions ?? []).filter((rule) => !BrowserMachine.isGrant(rule)),
  ]
  // The attachment's grant is a session rule, evaluated after every agent rule, so core resolves every browser call to
  // allow. The rules from config, the agent's definition and the session itself decide instead: a deny refuses the
  // call, and an ask makes the permission check prompt as it would without the grant. No matching rule leaves it
  // allowed.
  yield* ctx.permission.hook("evaluate", (event) =>
    event.action !== "browser" || event.effect === "deny"
      ? Effect.void
      : ctx.session.get({ sessionID: event.sessionID }).pipe(
          Effect.map((session) => {
            const rules = rulesFor(session, event.agent)
            const denied = denial(rules, event.resources)
            if (denied) {
              event.effect = "deny"
              event.message = denied
              return
            }
            if (
              event.resources.some((operation) => BrowserMachine.selectBrowserRule(rules, operation)?.effect === "ask")
            )
              event.effect = "ask"
          }),
          // Without the rules, the grant must not decide alone.
          Effect.catchCause((cause) =>
            Effect.logWarning("Browser permission evaluation failed", cause).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  event.effect = "deny"
                  event.message = "Browser permissions could not be read; no action ran."
                }),
              ),
            ),
          ),
        ),
  )
  // Permission syncs run here. Registered first, so it closes last: after disposal has drained the revokes.
  const work = yield* Scope.make()
  yield* Effect.addFinalizer((exit) => Scope.close(work, exit))
  const machine = { state: BrowserMachine.createConnectionState() }
  const attachments = new Map<number, Attachment>()
  const requests = new Map<string, Deferred.Deferred<Browser.Result, Tool.Error>>()
  const drained = Deferred.makeUnsafe<void>()
  // One event at a time, effects included, so controls reach the bus in transition order: `attached` before any
  // `command` of that attachment.
  const lock = Semaphore.makeUnsafe(1)
  const step = (event: BrowserMachine.ConnectionEvent): Effect.Effect<void> =>
    Effect.suspend(() => {
      const next = BrowserMachine.transitionConnection(machine.state, event)
      machine.state = next.state
      return Effect.forEach(
        next.effects,
        (effect) =>
          perform(effect).pipe(Effect.catchCause((cause) => Effect.logWarning("Browser effect failed", cause))),
        { discard: true },
      )
    })
  const dispatch = (event: BrowserMachine.ConnectionEvent) => lock.withPermit(step(event))
  const perform = (effect: BrowserMachine.ConnectionEffect): Effect.Effect<void, unknown> => {
    if (effect.type === "sync-permissions") return Effect.asVoid(Effect.forkIn(syncPermissions(effect), work))
    if (effect.type === "close-attachment")
      return Effect.suspend(() => {
        const attachment = attachments.get(effect.attempt)
        if (!attachment) return Effect.void
        attachments.delete(effect.attempt)
        attachment.tunnels.dispose()
        return Deferred.done(
          attachment.closed,
          effect.outcome === "unavailable" ? Exit.fail(effect.outcome) : Exit.succeed(effect.outcome),
        ).pipe(Effect.asVoid)
      })
    if (effect.type === "emit-control") return rpc.events.emit("control", effect.control)
    if (effect.type === "dispatch-command")
      return (
        rpc.events
          .emit("control", { type: "command", connectionID: effect.connectionID, requestID: effect.requestID })
          // Already inside the lock, so the failure steps directly.
          .pipe(Effect.catch((error) => step({ ...effect, type: "request.dispatch-failed", error })))
      )
    if (effect.type === "settle-request")
      return Effect.suspend(() => {
        const result = requests.get(effect.requestID)
        if (!result) return Effect.void
        requests.delete(effect.requestID)
        return Deferred.done(
          result,
          effect.settlement.ok ? Exit.succeed(effect.settlement.result) : Exit.fail(effect.settlement.error),
        ).pipe(Effect.asVoid)
      })
    if (effect.type === "warn") return Effect.logWarning(effect.message, effect.error)
    return Deferred.done(drained, Exit.void).pipe(Effect.asVoid)
  }
  const owner: typeof GrantOwner.Encoded = {
    host: hostname(),
    pid: process.pid,
    location: {
      directory: ctx.location.directory,
      ...(ctx.location.workspaceID === undefined ? {} : { workspaceID: ctx.location.workspaceID }),
    },
  }
  const syncPermissions = (effect: Extract<BrowserMachine.ConnectionEffect, { readonly type: "sync-permissions" }>) =>
    // The owner is recorded before the grant and forgotten after the revoke, so a stored grant always has one.
    (effect.allow
      ? ctx.storage
          .set(GRANT_PREFIX + effect.sessionID, owner)
          .pipe(Effect.andThen(writePermissions(ctx, effect.sessionID, true)))
      : writePermissions(ctx, effect.sessionID, false).pipe(
          Effect.andThen(ctx.storage.remove(GRANT_PREFIX + effect.sessionID)),
        )
    ).pipe(
      Effect.timeoutOption(Duration.millis(BrowserMachine.PERMISSION_SYNC_TIMEOUT_MS)),
      Effect.matchCauseEffect({
        onSuccess: (done) =>
          dispatch({
            type: Option.isSome(done) ? "permissions.synced" : "permissions.timed-out",
            sessionID: effect.sessionID,
            attempt: effect.attempt,
          }),
        onFailure: (cause) =>
          dispatch({
            type: "permissions.failed",
            sessionID: effect.sessionID,
            attempt: effect.attempt,
            error: Cause.squash(cause),
          }),
      }),
    )
  const tunnels = (input: {
    sessionID: Session.ID
    connectionID: string
  }): Effect.Effect<BrowserTunnel.Tunnels, Error> => {
    const attempt = BrowserMachine.selectAttachment(machine.state, input.sessionID, input.connectionID)
    const attachment = attempt === undefined ? undefined : attachments.get(attempt)
    return attachment
      ? Effect.succeed(attachment.tunnels)
      : Effect.fail(new Error("Browser attachment is unavailable; its network connections were closed."))
  }
  yield* reconcileStaleGrants(ctx)
  const rpc: RpcRegistration<typeof Browser.Definition> = yield* ctx.rpc
    .register(Browser.Definition, {
      attach: (input, call) =>
        Effect.gen(function* () {
          const session = yield* ctx.session
            .get({ sessionID: input.sessionID })
            .pipe(Effect.mapError(() => call.error("unavailable", "Session not found.", {})))
          if (session.location.directory !== ctx.location.directory)
            return yield* Effect.fail(call.error("unavailable", "Session belongs to another location.", {}))
          return yield* Effect.acquireUseRelease(
            lock.withPermit(
              Effect.suspend(() => {
                if (BrowserMachine.isConnectionDisposed(machine.state))
                  return Effect.fail(call.error("unavailable", "Browser is unavailable.", {}))
                const attempt = BrowserMachine.selectNextAttempt(machine.state)
                const attachment: Attachment = { closed: Deferred.makeUnsafe(), tunnels: BrowserTunnel.make() }
                attachments.set(attempt, attachment)
                return step({
                  type: "attach.started",
                  sessionID: input.sessionID,
                  attempt,
                  connectionID: input.connectionID,
                }).pipe(Effect.as({ attempt, attachment }))
              }),
            ),
            (attached) =>
              Deferred.await(attached.attachment.closed).pipe(
                Effect.mapError(() => call.error("unavailable", "Browser permissions could not be granted.", {})),
              ),
            (attached) => dispatch({ type: "attach.closed", sessionID: input.sessionID, attempt: attached.attempt }),
          )
        }),
      state: (input, call) =>
        Effect.suspend(() =>
          BrowserMachine.isAttachedConnection(machine.state, input.sessionID, input.connectionID)
            ? dispatch({
                type: "state.updated",
                sessionID: input.sessionID,
                connectionID: input.connectionID,
                browserState: input.state,
              })
            : Effect.fail(call.error("unavailable", "Browser is unavailable.", {})),
        ),
      command: (input, call) =>
        Effect.suspend(() => {
          const command = BrowserMachine.selectPendingCommand(
            machine.state,
            input.sessionID,
            input.connectionID,
            input.requestID,
          )
          return command
            ? Effect.succeed(command)
            : Effect.fail(call.error("unavailable", "Browser request is no longer available.", {}))
        }),
      result: (input, call) =>
        Effect.suspend(() =>
          BrowserMachine.isAttachedConnection(machine.state, input.sessionID, input.connectionID)
            ? dispatch({ type: "request.settled", ...input })
            : Effect.fail(call.error("unavailable", "Browser is unavailable.", {})),
        ),
      "tunnel.open": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.open(input.target)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
      "tunnel.read": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.read(input.tunnelID)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
      "tunnel.write": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.write(input.tunnelID, input.data, input.end)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
      "tunnel.close": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.close(input.tunnelID)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
    })
    .pipe(Effect.orDie)
  yield* ctx.event.subscribe({ types: ["session.deleted", "session.moved"] }).pipe(
    Stream.runForEach((event) =>
      dispatch({
        type: event.type === "session.deleted" ? "session.deleted" : "session.moved",
        sessionID: event.data.sessionID,
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
  // A child copies its parent's permissions, browser grant included, but not the attachment. The grant is revoked while
  // the child's prompt is admitted, so no step of the child lists browser tools. The lock keeps an attachment of the
  // child's own from starting meanwhile; one that already exists keeps its grant.
  yield* ctx.session.hook("prompt", (event) =>
    ctx.session.get({ sessionID: event.sessionID }).pipe(
      Effect.flatMap((session) =>
        session.parentID === undefined || !session.permissions?.some(BrowserMachine.isGrant)
          ? Effect.void
          : lock.withPermit(
              Effect.suspend(() =>
                BrowserMachine.hasSession(machine.state, session.id)
                  ? Effect.void
                  : writePermissions(ctx, session.id, false),
              ),
            ),
      ),
      Effect.catchCause((cause) => Effect.logWarning("Browser permission revoke failed", cause)),
    ),
  )
  // Registered last, so it runs first: attachments close and revokes drain while the RPC and `work` are still open.
  yield* Effect.addFinalizer(() => dispatch({ type: "disposed" }).pipe(Effect.andThen(Deferred.await(drained))))

  const request = Effect.fn("BrowserConnection.request")(function* (
    sessionID: Session.ID,
    connectionID: string,
    action: Browser.Action,
    tab: Browser.Tab | undefined,
    files: readonly Browser.File[],
    inspection: Pick<Browser.Command, "inspect" | "target">,
  ) {
    const requestID = crypto.randomUUID()
    const target = { sessionID, connectionID, requestID }
    const result = yield* Deferred.make<Browser.Result, Tool.Error>()
    const command = {
      action:
        (action.type === "files.upload" || action.type === "files.drop") && !inspection.inspect
          ? { ...action, paths: files.map((file) => file.name) }
          : action,
      ...(tab ? { generation: tab.generation } : {}),
      files,
      ...inspection,
    }
    // Once started, the request always reaches the machine's exit: a settlement, a timeout or a cancel.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.sync(() => requests.set(requestID, result)).pipe(
        Effect.andThen(dispatch({ type: "request.started", ...target, command })),
        Effect.andThen(
          restore(
            Deferred.await(result).pipe(
              Effect.timeoutOrElse({
                duration: Duration.millis(BrowserMachine.REQUEST_TIMEOUT_MS),
                orElse: () =>
                  dispatch({ type: "request.timed-out", ...target }).pipe(Effect.andThen(Deferred.await(result))),
              }),
            ),
          ),
        ),
        Effect.onInterrupt(() => dispatch({ type: "request.cancelled", ...target })),
        Effect.ensuring(Effect.sync(() => requests.delete(requestID))),
      ),
    )
  })

  return {
    /**
     * Refuses a call that config, the agent's definition or the session's own rules deny. It reads rules only and never
     * prompts, so it runs before the tool reads a file, looks up a tab or says whether a desktop is attached: a denied
     * call reveals nothing but the denial. Without a desktop the session has no grant, and core would deny the call
     * with its own message before any hook ran.
     */
    refuse: Effect.fn("BrowserConnection.refuse")(function* (tool: Tool.Context, operation: Browser.Method) {
      const session = yield* ctx.session
        .get({ sessionID: tool.sessionID })
        .pipe(Effect.mapError((error) => new Tool.Error({ message: `Session not found: ${tool.sessionID}`, error })))
      const denied = denial(rulesFor(session, tool.agent), [operation])
      if (denied) return yield* new Tool.Error({ message: denied })
    }),
    /**
     * The permission check for one call, with the operation as its resource. Its `permission.evaluate` hooks decide it:
     * this plugin's (configured denies and asks win over the grant) and others such as `tool.use` policies.
     */
    authorize: Effect.fn("BrowserConnection.authorize")(function* (tool: Tool.Context, operation: Browser.Method) {
      yield* ctx.permission.assert({
        sessionID: tool.sessionID,
        agent: tool.agent,
        action: "browser",
        resources: [operation],
        // "Always" approves this operation only, in core's saved approvals, never in the session rules the grant uses.
        save: [operation],
        source: { type: "tool", messageID: tool.messageID, id: tool.id },
      })
    }),
    /** Whether a desktop is attached to the session or attaching to it. */
    attached: (sessionID: Session.ID) => Effect.sync(() => BrowserMachine.hasAttachment(machine.state, sessionID)),
    target: Effect.fn("BrowserConnection.target")(function* (sessionID: Session.ID, action: Browser.Action) {
      const selected = BrowserMachine.selectTarget(machine.state, sessionID, action)
      if (!selected.ok) return yield* selected.error
      // Requests go to the attachment selected here. One that closes first, even while file IO waits, runs nothing.
      return {
        tab: selected.tab,
        inspect: () =>
          request(sessionID, selected.connectionID, action, selected.tab, [], { inspect: true }).pipe(
            Effect.flatMap((result) => Schema.decodeUnknownEffect(Browser.Target)(result.value)),
            Effect.mapError(
              (error) =>
                new Tool.Error({
                  message:
                    error instanceof Tool.Error
                      ? error.message
                      : "Browser returned invalid target metadata. Check desktop/plugin versions; no action was authorized.",
                  error,
                }),
            ),
          ),
        request: (files: readonly Browser.File[], target?: Browser.Target) =>
          request(sessionID, selected.connectionID, action, selected.tab, files, { target }),
      }
    }),
  }
})

/** The refusal for the first operation the rules deny, or undefined when they deny none. */
function denial(rules: readonly Permission.Rule[], operations: readonly string[]) {
  const denied = operations
    .map((operation) => ({ operation, rule: BrowserMachine.selectBrowserRule(rules, operation) }))
    .find((item) => item.rule?.effect === "deny")
  if (!denied) return undefined
  return denied.rule?.resource === "*"
    ? "[browser.denied] Browser tools are denied for this agent by configuration; no action ran. Do not retry browser tools."
    : `[browser.denied] browser.${denied.operation} is denied for this agent by configuration; no action ran. Do not retry it.`
}

function writePermissions(
  ctx: { readonly session: Pick<Context["session"], "get" | "update"> },
  sessionID: Session.ID,
  allow: boolean,
) {
  return ctx.session.get({ sessionID }).pipe(
    Effect.flatMap((session) => {
      const permissions = BrowserMachine.reconcileBrowserPermissions(session.permissions, allow)
      return permissions ? ctx.session.update({ sessionID, permissions }) : Effect.void
    }),
  )
}

// A process on another host, such as another container on a shared volume, cannot be checked; its grants count as live.
// A reused process ID also counts as live, which only leaves a stale grant in place.
function running(owner: typeof GrantOwner.Type) {
  if (owner.host !== hostname()) return true
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}
