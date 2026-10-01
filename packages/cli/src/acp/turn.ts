import type { CancelNotification, PromptRequest, PromptResponse, RequestError } from "@agentclientprotocol/sdk"
import {
  isSessionNotFoundError,
  type CommandInfo,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import { TokenUsage } from "@opencode/schema/token-usage"
import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Option,
  Queue,
  Ref,
  Scope,
  Stream,
} from "effect"
import { builtinCommands, type ACPCatalog, type Catalog } from "./catalog"
import { currentModel } from "./config-option"
import type { ACPConnection } from "./connection"
import { promptContentToParts } from "./content"
import { ACPError } from "./error"
import { replyPermission } from "./permission"
import { ACPPromise } from "./promise"
import type { ACPSessions, Attached } from "./sessions"
import { ACPTranslate } from "./translate"

type Failure = ACPError.Error | RequestError | ACPCatalog.Error

export interface Interface {
  /**
   * Runs the session's only turn. Cancelling it, including through the request's `$/cancel_request` signal,
   * interrupts the turn and still resolves with `stopReason: "cancelled"`.
   */
  readonly prompt: (input: PromptRequest, signal: AbortSignal) => Effect.Effect<PromptResponse, Failure>
  /** Interrupts the session's active turn and waits for it to settle. No-op when the session is idle. */
  readonly cancel: (input: CancelNotification) => Effect.Effect<void>
  /** Like `cancel`, but an idle session is still interrupted, since server work can outlive its turn. */
  readonly close: (sessionID: string) => Effect.Effect<void, ACPError.Error | RequestError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Turn") {}

/**
 * How long a cancelled turn keeps forwarding the server's wind-down. Core acknowledges an interrupt before its
 * cleanup settles, and its shell tool waits 3 seconds before escalating to SIGKILL.
 */
export const CancelDrainTimeout = Context.Reference<Duration.Input>("@opencode/cli/acp/Turn/CancelDrainTimeout", {
  defaultValue: () => "5 seconds",
})

type PreparedPrompt = {
  readonly start: ACPTranslate.TurnStart
  readonly text: string
  readonly files: Array<{ readonly uri: string; readonly name?: string }>
  readonly synthetic: ReadonlyArray<string>
  readonly slash?: { readonly name: string; readonly args: string }
  readonly command?: CommandInfo
}

type PermissionAsk = Extract<ACPTranslate.Output, { readonly _tag: "PermissionAsk" }>

/** A turn's event feed. It moves to the session scope when the turn ends with children still running. */
type Subscription = {
  readonly scope: Scope.Closeable
  readonly events: Queue.Dequeue<OpenCodeEvent, unknown>
  /** Runs permission replies one at a time in ask order, without holding back the rest of the stream. */
  readonly permissions: Queue.Queue<Effect.Effect<void>>
  /** Completed when the turn is cancelled; pending and later asks are then rejected. */
  readonly cancelled: Deferred.Deferred<void>
}

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  /** Permission asks still run through the promise view. */
  readonly permissions: ACPConnection.Connection
  readonly sessions: ACPSessions.Interface
  readonly catalog: ACPCatalog.Interface
  readonly capabilities: Ref.Ref<{ readonly childSessionUpdates: boolean }>
}) {
  const scope = yield* Effect.scope
  const drainTimeout = yield* CancelDrainTimeout
  const turns = yield* FiberMap.make<string, PromptResponse, Failure>()

  const subscribe = Effect.fnUntraced(function* () {
    // Parented, so it still closes when the session scope it is handed to is already gone.
    const subscriptionScope = yield* Scope.fork(scope)
    const subscription: Subscription = {
      scope: subscriptionScope,
      events: yield* Stream.fromAsyncIterable(input.client.event.subscribe(), (cause) => cause).pipe(
        Stream.toQueue({ capacity: "unbounded" }),
        Scope.provide(subscriptionScope),
      ),
      permissions: yield* Queue.unbounded<Effect.Effect<void>>(),
      cancelled: yield* Deferred.make<void>(),
    }
    yield* Queue.take(subscription.permissions).pipe(Effect.flatten, Effect.forever, Effect.forkIn(subscriptionScope))
    return subscription
  })

  const take = (subscription: Subscription) =>
    Queue.take(subscription.events).pipe(
      Effect.catch((error) =>
        Cause.isDone(error) ? Effect.fail(new ACPError.ServerUnavailableError()) : ACPPromise.classify(error),
      ),
    )

  // A turn settles only after the permission asks it saw have been answered.
  const permissionsSettled = Effect.fnUntraced(function* (subscription: Subscription) {
    const settled = yield* Deferred.make<void>()
    yield* Queue.offer(subscription.permissions, Deferred.succeed(settled, undefined).pipe(Effect.asVoid))
    yield* Deferred.await(settled)
  })

  // Interruption cancels the client's permission request; the server still gets the resulting rejection.
  const reply = (subscription: Subscription, ctx: ACPTranslate.Context, ask: PermissionAsk) =>
    Effect.callback<void>((resume, signal) => {
      const replied = replyPermission({
        client: input.client,
        connection: input.permissions,
        event: ask.event,
        sessionID: ask.event.data.sessionID,
        clientSessionID: ctx.sessionID,
        cwd: ctx.cwd,
        tool: ask.tool,
        signal,
        ...(ask.child ? { toolCallPrefix: ask.child.id, titlePrefix: ask.child.title } : {}),
      }).then(
        () => resume(Effect.void),
        (cause) => resume(Effect.logWarning("ACP permission reply failed", cause)),
      )
      return Effect.promise(() => replied)
    }).pipe(Effect.raceFirst(Deferred.await(subscription.cancelled)))

  const interpret = (subscription: Subscription, ctx: ACPTranslate.Context, output: ACPTranslate.Output) => {
    switch (output._tag) {
      case "SessionUpdate":
        return input.connection.sessionUpdate({ sessionId: ctx.sessionID, update: output.update })
      case "ChildUpdate":
        return input.connection
          .extNotification(ACPTranslate.ChildSessionUpdateMethod, output.update)
          .pipe(Effect.ignoreCause)
      case "PermissionAsk":
        return Queue.offer(subscription.permissions, reply(subscription, ctx, output)).pipe(Effect.asVoid)
      case "FormCancel":
        return Effect.tryPromise(() =>
          input.client.session.form.cancel({ sessionID: output.sessionID, formID: output.formID }),
        ).pipe(Effect.catch(() => interruptServer(output.sessionID)))
    }
  }

  const consume = Effect.fnUntraced(function* (
    subscription: Subscription,
    ctx: ACPTranslate.Context,
    state: Ref.Ref<ACPTranslate.TurnState>,
  ) {
    while (true) {
      const event = yield* take(subscription)
      const next = ACPTranslate.step(yield* Ref.get(state), event, ctx)
      yield* Ref.set(state, next.state)
      yield* Effect.forEach(next.outputs, (output) => interpret(subscription, ctx, output), { discard: true })
      if (next.terminal) {
        yield* permissionsSettled(subscription)
        return next.terminal
      }
    }
  })

  const submit = Effect.fnUntraced(function* (attached: Attached, prompt: PreparedPrompt) {
    const sessionID = attached.id
    if (prompt.synthetic.length > 0) {
      yield* ACPPromise.promise((signal) =>
        input.client.session.synthetic(
          {
            sessionID,
            text: prompt.synthetic.join("\n\n"),
            description: "ACP embedded context",
            delivery: "steer",
            resume: false,
          },
          { signal },
        ),
      )
    }
    if (prompt.start.type === "compaction") {
      yield* ACPPromise.promise((signal) =>
        input.client.session.compact({ sessionID, id: prompt.start.id }, { signal }),
      )
      return
    }
    const command = prompt.command
    if (command) {
      yield* ACPPromise.promise((signal) =>
        input.client.session.command(
          { sessionID, name: command.name, text: prompt.slash?.args ?? "", files: prompt.files, delivery: "steer" },
          { signal },
        ),
      )
      return
    }
    yield* ACPPromise.promise((signal) =>
      input.client.session.prompt(
        { sessionID, id: prompt.start.id, text: prompt.text, files: prompt.files, delivery: "steer" },
        { signal },
      ),
    )
  })

  const interruptServer = (sessionID: string) =>
    ACPPromise.promise(() => input.client.session.interrupt({ sessionID })).pipe(Effect.ignoreCause)

  // Rejects pending asks, interrupts the server once, then forwards its wind-down until the terminal event or the
  // timeout. Tools still open at the timeout are reported failed so the client never shows them running.
  const windDown = Effect.fnUntraced(function* (
    subscription: Subscription,
    ctx: ACPTranslate.Context,
    state: Ref.Ref<ACPTranslate.TurnState>,
    events: Fiber.Fiber<ACPTranslate.Terminal, Failure>,
  ) {
    yield* Deferred.succeed(subscription.cancelled, undefined)
    yield* interruptServer(ctx.sessionID)
    if (!(yield* Ref.get(state)).started) return
    if (Option.isSome(yield* Fiber.await(events).pipe(Effect.timeoutOption(drainTimeout)))) return
    yield* Fiber.interrupt(events)
    const abandoned = ACPTranslate.abandonTools(yield* Ref.get(state), ctx)
    yield* Ref.set(state, abandoned.state)
    yield* Effect.forEach(abandoned.outputs, (output) => interpret(subscription, ctx, output), { discard: true }).pipe(
      Effect.ignore,
    )
  })

  const execute = (
    attached: Attached,
    prompt: PreparedPrompt,
    ctx: ACPTranslate.Context,
    state: Ref.Ref<ACPTranslate.TurnState>,
  ) =>
    Effect.acquireUseRelease(
      subscribe(),
      (subscription) =>
        Effect.gen(function* () {
          // The feed opens with `server.connected`, so every event the submission causes comes after it.
          const connected = yield* take(subscription)
          if (connected.type !== "server.connected")
            return yield* Effect.die(new Error(`expected server.connected, got ${connected.type}`))
          const events = yield* consume(subscription, ctx, state).pipe(Effect.forkScoped)
          return yield* Effect.gen(function* () {
            yield* submit(attached, prompt)
            if (prompt.command) return "succeeded" as const
            return yield* Fiber.join(events)
          }).pipe(Effect.onInterrupt(() => windDown(subscription, ctx, state, events)))
        }).pipe(Effect.scoped),
      (subscription, exit) => handoff(attached, subscription, ctx, state, exit),
    )

  const handoff = Effect.fnUntraced(function* (
    attached: Attached,
    subscription: Subscription,
    ctx: ACPTranslate.Context,
    state: Ref.Ref<ACPTranslate.TurnState>,
    exit: Exit.Exit<ACPTranslate.Terminal, Failure>,
  ) {
    const close = Scope.close(subscription.scope, Exit.void)
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) return yield* close
    if ((yield* Ref.get(state)).openChildren.size === 0) return yield* close
    // Children that outlive a cancelled turn were not cancelled, so their asks still go to the client.
    const cancelled = yield* Deferred.make<void>()
    const background = consume({ ...subscription, cancelled }, { ...ctx, mode: "background" }, state).pipe(
      Effect.ignore,
      Effect.ensuring(close),
      Effect.withSpan("cli.acp.turn.background"),
    )
    yield* input.sessions.fork(attached, background).pipe(Effect.catchTag("ACPSessionNotFoundError", () => close))
  })

  const settle = Effect.fnUntraced(function* (
    attached: Attached,
    state: Ref.Ref<ACPTranslate.TurnState>,
    exit: Exit.Exit<ACPTranslate.Terminal, Failure>,
  ) {
    if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
    const current = yield* Ref.get(state)
    const failure = ACPTranslate.failure(current)
    if (failure) return yield* failure
    yield* sendUsageUpdate(attached, current)
    return ACPTranslate.response(current, attached.id, Exit.isSuccess(exit) ? exit.value : "interrupted")
  })

  const sendUsageUpdate = Effect.fn("cli.acp.turn.usage")(
    function* (attached: Attached, state: ACPTranslate.TurnState) {
      const used = state.usage ? TokenUsage.total(state.usage.last) : 0
      if (!used) return
      const catalog = yield* input.catalog.get(attached.cwd)
      const current = currentModel(catalog, yield* Ref.get(attached.selection))
      const model = catalog.models.find((item) => item.providerID === current.providerID && item.id === current.id)
      if (!model?.limit.context) return
      const info = yield* ACPPromise.promise((signal) =>
        input.client.session.get({ sessionID: attached.id }, { signal }),
      )
      yield* input.connection.sessionUpdate({
        sessionId: attached.id,
        update: {
          sessionUpdate: "usage_update",
          used,
          size: model.limit.context,
          cost: { amount: info.cost, currency: "USD" },
        },
      })
    },
    (effect) => Effect.ignoreCause(effect),
  )

  // Forked uninterruptible: interruption reaches only `execute`, so the fiber still settles with a response.
  const run = Effect.fn("cli.acp.turn.run")(function* (
    attached: Attached,
    prompt: PreparedPrompt,
    childUpdates: boolean,
  ) {
    const state = yield* Ref.make(ACPTranslate.initial)
    const ctx: ACPTranslate.Context = {
      sessionID: attached.id,
      cwd: attached.cwd,
      start: prompt.start,
      childUpdates,
      mode: "turn",
    }
    const exit = yield* Effect.exit(Effect.interruptible(execute(attached, prompt, ctx, state)))
    return yield* settle(attached, state, exit)
  })

  return Service.of({
    prompt: Effect.fn("cli.acp.turn.prompt")(function* (params, signal) {
      const attached = yield* input.sessions.require(params.sessionId)
      const catalog = yield* input.catalog.get(attached.cwd)
      const childUpdates = (yield* Ref.get(input.capabilities)).childSessionUpdates
      const prompt = preparePrompt(catalog, params.prompt, SessionMessage.ID.create())
      // Check and register in one synchronous step.
      const turn = yield* Effect.withFiber((fiber) => {
        if (FiberMap.hasUnsafe(turns, attached.id)) {
          return Effect.fail(
            new ACPError.ServiceFailureError({
              safeMessage: `Session already has an active ACP prompt: ${attached.id}`,
              service: "session",
            }),
          )
        }
        const forked = Effect.runForkWith(fiber.context)(run(attached, prompt, childUpdates), { uninterruptible: true })
        FiberMap.setUnsafe(turns, attached.id, forked)
        return Effect.succeed(forked)
      })
      // A `$/cancel_request` for this prompt cancels its turn like `session/cancel`, rather than failing the request.
      yield* aborted(signal).pipe(Effect.andThen(Fiber.interrupt(turn)), Effect.forkChild)
      return yield* Fiber.join(turn)
    }),
    cancel: Effect.fn("cli.acp.turn.cancel")(function* (params) {
      yield* FiberMap.remove(turns, params.sessionId)
    }),
    close: Effect.fn("cli.acp.turn.close")(function* (sessionID) {
      if (FiberMap.hasUnsafe(turns, sessionID)) return yield* FiberMap.remove(turns, sessionID)
      yield* ACPPromise.promise(() =>
        input.client.session.interrupt({ sessionID }).catch((error) => {
          if (!isSessionNotFoundError(error)) throw error
        }),
      )
    }),
  })
})

function aborted(signal: AbortSignal) {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void)
    const abort = () => resume(Effect.void)
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })
}

function preparePrompt(catalog: Catalog, prompt: PromptRequest["prompt"], messageID: string): PreparedPrompt {
  const parts = promptContentToParts(prompt)
  const visible = parts.filter((part) => part.type !== "text" || (!part.synthetic && !part.ignored))
  const synthetic = parts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : []))
  const text = visible.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const files = visible.flatMap((part) => (part.type === "file" ? [{ uri: part.url, name: part.filename }] : []))
  const slash = detectSlashCommand(text)
  const command = slash ? catalog.commands.find((item) => item.name === slash.name) : undefined
  const start = turnStart(messageID, slash)
  return { start, text, files, synthetic, slash, command }
}

function turnStart(messageID: string, slash: PreparedPrompt["slash"]): ACPTranslate.TurnStart {
  if (slash && builtinCommands.get(slash.name)?.start === "compaction") return { type: "compaction", id: messageID }
  return { type: "input", id: messageID }
}

function detectSlashCommand(text: string): { readonly name: string; readonly args: string } | undefined {
  const value = text.trim()
  if (!value.startsWith("/")) return undefined
  const [name, ...rest] = value.slice(1).split(/\s+/)
  if (!name) return undefined
  return { name, args: rest.join(" ").trim() }
}

export * as ACPTurn from "./turn"
