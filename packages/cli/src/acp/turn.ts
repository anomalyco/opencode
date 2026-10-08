import type { CancelNotification, PromptRequest, PromptResponse, RequestError } from "@agentclientprotocol/sdk"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/effect"
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
import type { Capabilities } from "./capabilities"
import { findModel, type ACPCatalog } from "./catalog"
import { ACPChild } from "./child"
import { ACPClient } from "./client"
import { currentModel } from "./config-option"
import type { ACPConnection } from "./connection"
import { ACPElicitation } from "./elicitation"
import { ACPError } from "./error"
import { ACPPermission } from "./permission"
import { ACPPrompt } from "./prompt"
import type { ACPSessions, Attached } from "./sessions"
import { ACPTranslate } from "./translate"

export interface Interface {
  readonly prompt: (input: PromptRequest, signal: AbortSignal) => Effect.Effect<PromptResponse, ACPError.Failure>
  readonly cancel: (input: CancelNotification) => Effect.Effect<void>
  /** Unlike `cancel`, interrupts an idle session too, since server work can outlive its turn. */
  readonly close: (sessionID: string) => Effect.Effect<void, ACPError.Error | RequestError>
}

/** Core acknowledges an interrupt before its cleanup settles, and its shell tool waits 3s before SIGKILL. */
export const CancelDrainTimeout = Context.Reference<Duration.Input>("@opencode/cli/acp/Turn/CancelDrainTimeout", {
  defaultValue: () => "5 seconds",
})

type Subscription = {
  readonly scope: Scope.Closeable
  readonly events: Queue.Dequeue<OpenCodeEvent, unknown>
  readonly askQueue: Queue.Queue<Effect.Effect<void, ACPError.Error | RequestError>>
  readonly settled: Map<string, Deferred.Deferred<void>>
}

type Turn = {
  readonly ctx: ACPTranslate.TurnContext
  readonly state: Ref.Ref<ACPTranslate.TurnState>
  readonly subscription: Subscription
  readonly cancelled: Deferred.Deferred<void>
  readonly background: boolean
}

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly sessions: ACPSessions.Interface
  readonly catalog: ACPCatalog.Interface
  readonly capabilities: Ref.Ref<Capabilities>
}) {
  const scope = yield* Effect.scope
  const drainTimeout = yield* CancelDrainTimeout
  const turns = yield* FiberMap.make<string, PromptResponse, ACPError.Failure>()

  const open = Effect.fnUntraced(function* (ctx: ACPTranslate.TurnContext, state: Ref.Ref<ACPTranslate.TurnState>) {
    // Parented to the service scope; the session scope may already be closed.
    const subscriptionScope = yield* Scope.fork(scope)
    const subscription: Subscription = {
      scope: subscriptionScope,
      events: yield* input.client.event
        .subscribe()
        .pipe(Stream.toQueue({ capacity: "unbounded" }), Scope.provide(subscriptionScope)),
      askQueue: yield* Queue.unbounded<Effect.Effect<void, ACPError.Error | RequestError>>(),
      settled: new Map(),
    }
    yield* Queue.take(subscription.askQueue).pipe(
      Effect.flatten,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP ask reply failed", cause),
      ),
      Effect.forever,
      Effect.forkIn(subscriptionScope),
    )
    return { ctx, state, subscription, cancelled: yield* Deferred.make<void>(), background: false } satisfies Turn
  })

  const take = (subscription: Subscription) =>
    Queue.take(subscription.events).pipe(
      Effect.catch((error) =>
        Cause.isDone(error) ? Effect.fail(new ACPError.ServerUnavailableError()) : ACPClient.classify(error),
      ),
    )

  const asksSettled = Effect.fnUntraced(function* (subscription: Subscription) {
    const settled = yield* Deferred.make<void>()
    yield* Queue.offer(subscription.askQueue, Deferred.succeed(settled, undefined).pipe(Effect.asVoid))
    yield* Deferred.await(settled)
  })

  const queueAsk = <A>(
    turn: Turn,
    id: string,
    ask: Effect.Effect<A, unknown>,
    fallback: A,
    respond: (outcome: A) => Effect.Effect<void, ACPError.Error | RequestError>,
  ) =>
    Effect.gen(function* () {
      const settled = yield* Deferred.make<void>()
      turn.subscription.settled.set(id, settled)
      yield* Queue.offer(
        turn.subscription.askQueue,
        Effect.uninterruptibleMask((restore) =>
          // The race starts racers in order and stops once one is done, so an earlier cancel never starts the ask.
          restore(
            Deferred.await(turn.cancelled).pipe(
              Effect.as(fallback),
              Effect.raceFirst(Deferred.await(settled).pipe(Effect.as("settled" as const))),
              Effect.raceFirst(ask),
            ),
          ).pipe(
            Effect.tapCauseIf(Cause.hasDies, (cause) => Effect.logWarning("ACP ask failed", cause)),
            Effect.catchCause(() => Effect.succeed(fallback)),
            Effect.flatMap((outcome) => (outcome === "settled" ? Effect.void : respond(outcome))),
          ),
        ).pipe(Effect.withSpan("cli.acp.turn.ask")),
      )
    })

  const interpret = (turn: Turn, output: ACPTranslate.Output) => {
    switch (output._tag) {
      case "SessionUpdate":
        if (turn.background) return Effect.void
        return ACPPermission.withCompletedDiffs(output.update, output.diff, turn.ctx.cwd).pipe(
          Effect.flatMap((update) => input.connection.sessionUpdate({ sessionId: turn.ctx.sessionID, update })),
        )
      case "ChildUpdate":
        return Effect.gen(function* () {
          if (output.update.type !== "update")
            return yield* input.connection.extNotification(ACPChild.UpdateMethod, output.update)
          const update = yield* ACPPermission.withCompletedDiffs(output.update.update, output.diff, turn.ctx.cwd)
          return yield* input.connection.extNotification(ACPChild.UpdateMethod, { ...output.update, update })
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logWarning("ACP child session update failed", cause),
          ),
        )
      case "PermissionAsk": {
        const permission = {
          client: input.client,
          connection: input.connection,
          event: output.event,
          sessionID: output.event.data.sessionID,
          clientSessionID: turn.ctx.sessionID,
          cwd: turn.ctx.cwd,
          tool: output.tool,
          child: output.child,
        }
        return queueAsk(turn, output.event.data.id, ACPPermission.ask(permission), "reject", (decision) =>
          ACPPermission.respond(permission, decision),
        )
      }
      case "FormAsk":
        return Effect.gen(function* () {
          const capabilities = yield* Ref.get(input.capabilities)
          const requestedSchema = ACPElicitation.requestedSchema(output.form, capabilities)
          if (!requestedSchema) return yield* ACPElicitation.cancelUnshown(input.client, output.form)
          const elicitation = {
            client: input.client,
            connection: input.connection,
            form: output.form,
            requestedSchema,
            clientSessionID: turn.ctx.sessionID,
            child: output.child,
            toolCallSent: !turn.background && (!output.child || !turn.ctx.childUpdates),
          }
          yield* queueAsk(turn, output.form.id, ACPElicitation.ask(elicitation), "cancel", (outcome) =>
            ACPElicitation.respond(elicitation, outcome),
          )
        })
      case "AskSettled":
        return Effect.suspend(() => {
          const settled = turn.subscription.settled.get(output.id)
          turn.subscription.settled.delete(output.id)
          return settled ? Deferred.succeed(settled, undefined) : Effect.void
        })
    }
  }

  const advance = Effect.fnUntraced(function* (turn: Turn) {
    const event = yield* take(turn.subscription)
    const folded = yield* Ref.modify(turn.state, (current) => {
      const next =
        turn.background && !ACPTranslate.fromTrackedChild(current, event)
          ? { state: current, outputs: [] }
          : ACPTranslate.fold(current, event, turn.ctx)
      return [next, next.state]
    })
    yield* Effect.forEach(folded.outputs, (output) => interpret(turn, output), { discard: true })
    return folded
  })

  const consume = Effect.fnUntraced(function* (turn: Turn) {
    while (true) {
      const folded = yield* advance(turn)
      if (folded.terminal) {
        // A registered executor can own several execution cycles. Its return,
        // rather than the first terminal event, ends command-owned streaming.
        if (turn.ctx.command && !(yield* Deferred.isDone(turn.cancelled))) continue
        yield* asksSettled(turn.subscription)
        return folded.terminal
      }
    }
  })

  const followChildren = Effect.fnUntraced(function* (turn: Turn) {
    while (true) {
      const folded = yield* advance(turn)
      if (folded.state.openChildren.size === 0) return yield* asksSettled(turn.subscription)
    }
  })

  const submit = Effect.fnUntraced(function* (attached: Attached, prompt: ACPPrompt.Prepared) {
    const sessionID = attached.id
    if (prompt.synthetic.length > 0) {
      yield* input.client.session
        .synthetic({
          sessionID,
          text: prompt.synthetic.join("\n\n"),
          description: "ACP embedded context",
          delivery: "steer",
          resume: false,
        })
        .pipe(Effect.catch(ACPClient.classify))
    }
    if (prompt.start.type === "compaction") {
      yield* input.client.session.compact({ sessionID, id: prompt.start.id }).pipe(Effect.catch(ACPClient.classify))
      return
    }
    const command = prompt.command
    if (command) {
      yield* input.client.session
        .command({
          sessionID,
          name: command.name,
          text: prompt.slash?.args ?? "",
          files: prompt.files,
          delivery: "steer",
        })
        .pipe(Effect.catch(ACPClient.classify))
      return
    }
    yield* input.client.session
      .prompt({ sessionID, id: prompt.start.id, text: prompt.text, files: prompt.files, delivery: "steer" })
      .pipe(Effect.catch(ACPClient.classify))
  })

  const windDown = Effect.fnUntraced(function* (
    turn: Turn,
    events: Fiber.Fiber<ACPTranslate.Terminal, ACPError.Failure>,
  ) {
    yield* Deferred.succeed(turn.cancelled, undefined)
    yield* input.client.session
      .interrupt({ sessionID: turn.ctx.sessionID })
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP server interrupt failed", cause),
        ),
      )
    if (!(yield* Ref.get(turn.state)).started) return
    if (Option.exists(yield* Fiber.await(events).pipe(Effect.timeoutOption(drainTimeout)), Exit.isSuccess)) return
    yield* Fiber.interrupt(events)
    const abandoned = ACPTranslate.abandon(yield* Ref.get(turn.state), turn.ctx)
    yield* Ref.set(turn.state, abandoned.state)
    yield* Effect.forEach(abandoned.outputs, (output) => interpret(turn, output), { discard: true }).pipe(Effect.ignore)
  })

  const execute = (attached: Attached, prompt: ACPPrompt.Prepared, turn: Turn) =>
    Effect.gen(function* () {
      // The feed opens with `server.connected`, so every event the submission causes comes after it.
      const connected = yield* take(turn.subscription)
      if (connected.type !== "server.connected")
        return yield* Effect.die(new Error(`expected server.connected, got ${connected.type}`))
      const events = yield* consume(turn).pipe(Effect.forkScoped)
      return yield* Effect.gen(function* () {
        yield* submit(attached, prompt)
        if (prompt.command) return (yield* Ref.get(turn.state)).terminal ?? "succeeded"
        return yield* Fiber.join(events)
      }).pipe(Effect.onInterrupt(() => windDown(turn, events)))
    }).pipe(Effect.scoped)

  const handoff = Effect.fnUntraced(function* (
    attached: Attached,
    turn: Turn,
    exit: Exit.Exit<ACPTranslate.Terminal, ACPError.Failure>,
  ) {
    const close = Scope.close(turn.subscription.scope, Exit.void)
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) return yield* close
    const state = yield* Ref.get(turn.state)
    if (state.openChildren.size === 0) return yield* close
    // Children outlive a cancelled turn, so their asks still reach the client.
    const background = followChildren({
      ...turn,
      state: yield* Ref.make(state),
      cancelled: yield* Deferred.make<void>(),
      background: true,
    }).pipe(Effect.ignore, Effect.ensuring(close), Effect.withSpan("cli.acp.turn.background"))
    yield* input.sessions.fork(attached, background).pipe(Effect.catchTag("ACPSessionNotFoundError", () => close))
  })

  const settle = Effect.fnUntraced(function* (
    attached: Attached,
    current: ACPTranslate.TurnState,
    exit: Exit.Exit<ACPTranslate.Terminal, ACPError.Failure>,
  ) {
    if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
    const terminal = Exit.isSuccess(exit) ? exit.value : "interrupted"
    const failure = terminal === "interrupted" ? undefined : ACPTranslate.failure(current)
    if (failure) return yield* failure
    yield* sendUsageUpdate(attached, current)
    const cancelledWhileSettling = Exit.isFailure(yield* Effect.exit(Effect.interruptible(Effect.void)))
    return ACPTranslate.response(current, attached.id, cancelledWhileSettling ? "interrupted" : terminal)
  })

  const sendUsageUpdate = Effect.fn("cli.acp.turn.usage")(
    function* (attached: Attached, state: ACPTranslate.TurnState) {
      const used = state.usage ? TokenUsage.total(state.usage.last) : 0
      if (!used) return
      const catalog = yield* input.catalog.get(attached.cwd)
      const model = findModel(catalog.models, currentModel(catalog, yield* Ref.get(attached.selection)))
      if (!model?.limit.context) return
      const info = yield* input.client.session.get({ sessionID: attached.id }).pipe(Effect.catch(ACPClient.classify))
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
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP usage update failed", cause),
    ),
  )

  // Forked uninterruptible: interruption lands only in `execute` and the last check in `settle`, so a response follows.
  const run = Effect.fn("cli.acp.turn.run")(function* (params: PromptRequest) {
    const attached = yield* input.sessions.require(params.sessionId)
    const prompt = yield* ACPPrompt.prepare(yield* input.catalog.get(attached.cwd), params.prompt)
    const capabilities = yield* Ref.get(input.capabilities)
    const state = yield* Ref.make(ACPTranslate.initial)
    const exit = yield* Effect.acquireUseRelease(
      open(
        {
          sessionID: attached.id,
          cwd: attached.cwd,
          start: prompt.start,
          command: prompt.command !== undefined,
          childUpdates: capabilities.childSessionUpdates,
          compaction: capabilities.compaction,
        },
        state,
      ),
      (turn) => execute(attached, prompt, turn),
      (turn, exit) => handoff(attached, turn, exit),
    ).pipe(Effect.interruptible, Effect.exit)
    return yield* settle(attached, yield* Ref.get(state), exit)
  })

  return {
    prompt: Effect.fnUntraced(function* (params, signal) {
      // Synchronous and before setup, so concurrent prompts cannot both register and an early cancel still applies.
      const turn = yield* Effect.withFiber((fiber) => {
        if (FiberMap.hasUnsafe(turns, params.sessionId)) {
          return Effect.fail(
            new ACPError.ServiceFailureError({
              safeMessage: `Session already has an active ACP prompt: ${params.sessionId}`,
              service: "session",
            }),
          )
        }
        const forked = Effect.runForkWith(fiber.context)(run(params), { uninterruptible: true })
        FiberMap.setUnsafe(turns, params.sessionId, forked)
        return Effect.succeed(forked)
      })
      // A `$/cancel_request` for this prompt cancels its turn like `session/cancel`, rather than failing the request.
      yield* aborted(signal).pipe(Effect.andThen(Fiber.interrupt(turn)), Effect.forkChild)
      return yield* Fiber.join(turn)
    }),
    cancel: Effect.fnUntraced(function* (params) {
      yield* FiberMap.remove(turns, params.sessionId)
    }),
    close: Effect.fn("cli.acp.turn.close")(function* (sessionID) {
      if (FiberMap.hasUnsafe(turns, sessionID)) return yield* FiberMap.remove(turns, sessionID)
      yield* ACPClient.decodeSessionID(sessionID).pipe(
        Effect.flatMap((id) => input.client.session.interrupt({ sessionID: id })),
        Effect.catchTag(["ACPInvalidRequestError", "SessionNotFoundError"], () => Effect.void),
        Effect.catch(ACPClient.classify),
      )
    }),
  } satisfies Interface
})

function aborted(signal: AbortSignal) {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void)
    const abort = () => resume(Effect.void)
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })
}

export * as ACPTurn from "./turn"
