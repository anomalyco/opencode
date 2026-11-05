export * as BrowserConnection from "./connection.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { RpcRegistration } from "@opencode/plugin/effect/rpc"
import type { Session } from "@opencode/schema/session"
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

/**
 * A crash or SIGKILL skips the attachment finalizer, so the session keeps the allow rules while the
 * in-memory attachment is gone. Reconcile only this plugin instance's location, before registering
 * its RPC handlers. Running this in the background could revoke a newly attached browser's grants.
 */
export const reconcileStaleGrants = Effect.fn("BrowserConnection.reconcileStaleGrants")(function* (
  ctx: Pick<Context, "session" | "location">,
) {
  const revoke = (session: Session.Info) => {
    // The list filter scopes the directory, but does not support workspace identity.
    if (session.location.workspaceID !== ctx.location.workspaceID) return Effect.void
    const permissions = BrowserMachine.reconcileBrowserPermissions(session.permissions, false)
    if (!permissions) return Effect.void
    return ctx.session.update({ sessionID: session.id, permissions }).pipe(Effect.ignore)
  }
  const page = (cursor?: Session.ListCursor): Effect.Effect<void> =>
    ctx.session.list(cursor === undefined ? { directory: ctx.location.directory } : { cursor }).pipe(
      Effect.flatMap((result) =>
        Effect.gen(function* () {
          yield* Effect.forEach(result.data, revoke, { discard: true })
          if (result.cursor.next !== undefined) yield* page(result.cursor.next)
        }),
      ),
      Effect.ignore,
    )

  yield* page()
})

export const make = Effect.fn("BrowserConnection.make")(function* (
  ctx: Pick<Context, "agent" | "rpc" | "session" | "location" | "event">,
) {
  yield* reconcileStaleGrants(ctx)
  // Appended after config, so every agent hides the browser until an attachment allows it.
  yield* ctx.agent.transform((editor) =>
    editor
      .list()
      .forEach((agent) =>
        agent.permissions.push(...BrowserMachine.ACCESS.map((rule) => ({ ...rule, effect: "deny" as const }))),
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
  const syncPermissions = (effect: Extract<BrowserMachine.ConnectionEffect, { readonly type: "sync-permissions" }>) =>
    ctx.session.get({ sessionID: effect.sessionID }).pipe(
      Effect.flatMap((session) => {
        const permissions = BrowserMachine.reconcileBrowserPermissions(session.permissions, effect.allow)
        return permissions ? ctx.session.update({ sessionID: effect.sessionID, permissions }) : Effect.void
      }),
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
