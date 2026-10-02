import type { CancelNotification, PromptRequest, PromptResponse, RequestError } from "@agentclientprotocol/sdk"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/effect"
import type { Command } from "@opencode/schema/command"
import type { Session } from "@opencode/schema/session"
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
import { access, constants } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { builtinCommands, type ACPCatalog, type Catalog } from "./catalog"
import { ACPClient } from "./client"
import { currentModel } from "./config-option"
import type { ACPConnection } from "./connection"
import { linkReference, promptContentToParts, type PromptPart } from "./content"
import { ACPElicitation } from "./elicitation"
import { ACPError } from "./error"
import { ACPPermission } from "./permission"
import type { ACPService } from "./service"
import type { ACPSessions, Attached } from "./sessions"
import { ACPTranslate } from "./translate"

type Failure = ACPError.Error | RequestError | ACPCatalog.Error

export interface Interface {
  readonly prompt: (input: PromptRequest, signal: AbortSignal) => Effect.Effect<PromptResponse, Failure>
  readonly cancel: (input: CancelNotification) => Effect.Effect<void>
  /** Unlike `cancel`, interrupts an idle session too, since server work can outlive its turn. */
  readonly close: (sessionID: string) => Effect.Effect<void, ACPError.Error | RequestError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Turn") {}

/** Core acknowledges an interrupt before its cleanup settles, and its shell tool waits 3s before SIGKILL. */
export const CancelDrainTimeout = Context.Reference<Duration.Input>("@opencode/cli/acp/Turn/CancelDrainTimeout", {
  defaultValue: () => "5 seconds",
})

type PreparedPrompt = {
  readonly start: ACPTranslate.TurnStart
  readonly text: string
  readonly files: Array<{ readonly uri: string; readonly name?: string }>
  readonly synthetic: ReadonlyArray<string>
  readonly slash?: { readonly name: string; readonly args: string }
  readonly command?: Command.Info
}

type PermissionAsk = Extract<ACPTranslate.Output, { readonly _tag: "PermissionAsk" }>

type Subscription = {
  readonly scope: Scope.Closeable
  readonly events: Queue.Dequeue<OpenCodeEvent, unknown>
  /** Asks run serially off the event stream. */
  readonly asks: Queue.Queue<Effect.Effect<void, ACPError.Error | RequestError>>
  readonly cancelled: Deferred.Deferred<void>
  readonly forms: Map<string, Deferred.Deferred<void>>
  /** Completed per asked permission once the server reports it replied. */
  readonly permissions: Map<string, Deferred.Deferred<void>>
}

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly sessions: ACPSessions.Interface
  readonly catalog: ACPCatalog.Interface
  readonly capabilities: Ref.Ref<ACPService.Capabilities>
}) {
  const scope = yield* Effect.scope
  const drainTimeout = yield* CancelDrainTimeout
  const turns = yield* FiberMap.make<string, PromptResponse, Failure>()

  const subscribe = Effect.fnUntraced(function* () {
    // Parented to the service scope; the session scope may already be closed.
    const subscriptionScope = yield* Scope.fork(scope)
    const subscription: Subscription = {
      scope: subscriptionScope,
      events: yield* input.client.event
        .subscribe()
        .pipe(Stream.toQueue({ capacity: "unbounded" }), Scope.provide(subscriptionScope)),
      asks: yield* Queue.unbounded<Effect.Effect<void, ACPError.Error | RequestError>>(),
      cancelled: yield* Deferred.make<void>(),
      forms: new Map(),
      permissions: new Map(),
    }
    yield* Queue.take(subscription.asks).pipe(
      Effect.flatten,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP permission reply failed", cause),
      ),
      Effect.forever,
      Effect.forkIn(subscriptionScope),
    )
    return subscription
  })

  const take = (subscription: Subscription) =>
    Queue.take(subscription.events).pipe(
      Effect.catch((error) =>
        Cause.isDone(error) ? Effect.fail(new ACPError.ServerUnavailableError()) : ACPClient.classify(error),
      ),
    )

  const asksSettled = Effect.fnUntraced(function* (subscription: Subscription) {
    const settled = yield* Deferred.make<void>()
    yield* Queue.offer(subscription.asks, Deferred.succeed(settled, undefined).pipe(Effect.asVoid))
    yield* Deferred.await(settled)
  })

  const reply = (
    subscription: Subscription,
    ctx: ACPTranslate.Context,
    ask: PermissionAsk,
    settled: Deferred.Deferred<void>,
  ) =>
    ACPPermission.reply(
      {
        client: input.client,
        connection: input.connection,
        event: ask.event,
        sessionID: ask.event.data.sessionID,
        clientSessionID: ctx.sessionID,
        cwd: ctx.cwd,
        tool: ask.tool,
        child: ask.child,
        settled: Deferred.await(settled),
      },
      Deferred.await(subscription.cancelled),
    )

  const interpret = (subscription: Subscription, ctx: ACPTranslate.Context, output: ACPTranslate.Output) => {
    switch (output._tag) {
      case "SessionUpdate":
        return input.connection.sessionUpdate({ sessionId: ctx.sessionID, update: output.update })
      case "ChildUpdate":
        return input.connection
          .extNotification(ACPTranslate.ChildSessionUpdateMethod, output.update)
          .pipe(Effect.ignoreCause({ log: true }))
      case "PermissionAsk":
        return Effect.gen(function* () {
          const settled = yield* Deferred.make<void>()
          subscription.permissions.set(output.event.data.id, settled)
          yield* Queue.offer(subscription.asks, reply(subscription, ctx, output, settled))
        })
      case "FormAsk":
        return Effect.gen(function* () {
          const capabilities = yield* Ref.get(input.capabilities)
          const requestedSchema = ACPElicitation.requestedSchema(output.form, capabilities)
          if (!requestedSchema) return yield* ACPElicitation.cancelUnshown(input.client, output.form)
          const settled = yield* Deferred.make<void>()
          subscription.forms.set(output.form.id, settled)
          yield* Queue.offer(
            subscription.asks,
            ACPElicitation.reply(
              {
                client: input.client,
                connection: input.connection,
                form: output.form,
                requestedSchema,
                clientSessionID: ctx.sessionID,
                child: output.child,
                toolCallSent: output.toolCallSent,
                settled: Deferred.await(settled),
              },
              Deferred.await(subscription.cancelled),
            ),
          )
        })
      case "FormSettled":
        return Effect.suspend(() => {
          const settled = subscription.forms.get(output.formID)
          subscription.forms.delete(output.formID)
          return settled ? Deferred.succeed(settled, undefined) : Effect.void
        })
      case "PermissionSettled":
        return Effect.suspend(() => {
          const settled = subscription.permissions.get(output.requestID)
          subscription.permissions.delete(output.requestID)
          return settled ? Deferred.succeed(settled, undefined) : Effect.void
        })
    }
  }

  const consume = Effect.fnUntraced(function* (
    subscription: Subscription,
    ctx: ACPTranslate.Context,
    state: Ref.Ref<ACPTranslate.TurnState>,
  ) {
    while (true) {
      const event = yield* take(subscription)
      const next = yield* Ref.modify(state, (current) => {
        const step = ACPTranslate.step(current, event, ctx)
        return [step, step.state]
      })
      yield* Effect.forEach(next.outputs, (output) => interpret(subscription, ctx, output), { discard: true })
      if (next.terminal) {
        yield* asksSettled(subscription)
        return next.terminal
      }
    }
  })

  const submit = Effect.fnUntraced(function* (attached: Attached, prompt: PreparedPrompt) {
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

  const interruptServer = (sessionID: Session.ID) =>
    input.client.session.interrupt({ sessionID }).pipe(Effect.ignoreCause({ log: true }))

  const windDown = Effect.fnUntraced(function* (
    subscription: Subscription,
    ctx: ACPTranslate.Context,
    state: Ref.Ref<ACPTranslate.TurnState>,
    events: Fiber.Fiber<ACPTranslate.Terminal, Failure>,
  ) {
    yield* Deferred.succeed(subscription.cancelled, undefined)
    yield* interruptServer(ctx.sessionID)
    if (!(yield* Ref.get(state)).started) return
    if (Option.exists(yield* Fiber.await(events).pipe(Effect.timeoutOption(drainTimeout)), Exit.isSuccess)) return
    yield* Fiber.interrupt(events)
    const abandoned = ACPTranslate.abandon(yield* Ref.get(state), ctx)
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
    // Children outlive a cancelled turn, so their asks still reach the client.
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
    (effect) => Effect.ignoreCause(effect, { log: true }),
  )

  // Forked uninterruptible: interruption reaches only `execute`, so the fiber still settles with a response.
  const run = Effect.fn("cli.acp.turn.run")(function* (attached: Attached, prompt: PreparedPrompt) {
    const capabilities = yield* Ref.get(input.capabilities)
    const state = yield* Ref.make(ACPTranslate.initial)
    const ctx: ACPTranslate.Context = {
      sessionID: attached.id,
      cwd: attached.cwd,
      start: prompt.start,
      childUpdates: capabilities.childSessionUpdates,
      compaction: capabilities.compaction,
      mode: "turn",
    }
    const exit = yield* Effect.exit(Effect.interruptible(execute(attached, prompt, ctx, state)))
    return yield* settle(attached, state, exit)
  })

  return Service.of({
    prompt: Effect.fn("cli.acp.turn.prompt")(function* (params, signal) {
      const attached = yield* input.sessions.require(params.sessionId)
      const catalog = yield* input.catalog.get(attached.cwd)
      if (params.prompt.some((block) => block.type === "image" && !block.data && !block.uri)) {
        return yield* new ACPError.InvalidRequestError({ message: "image content has no data or uri", field: "prompt" })
      }
      const parts = yield* Effect.forEach(promptContentToParts(params.prompt), referenceUnreadableFile, {
        concurrency: "unbounded",
      })
      const prompt = preparePrompt(catalog, parts, SessionMessage.ID.create())
      // Synchronous, so concurrent prompts for one session cannot both register.
      const turn = yield* Effect.withFiber((fiber) => {
        if (FiberMap.hasUnsafe(turns, attached.id)) {
          return Effect.fail(
            new ACPError.ServiceFailureError({
              safeMessage: `Session already has an active ACP prompt: ${attached.id}`,
              service: "session",
            }),
          )
        }
        const forked = Effect.runForkWith(fiber.context)(run(attached, prompt), { uninterruptible: true })
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
      yield* ACPClient.decodeSessionID(sessionID).pipe(
        Effect.flatMap((id) => input.client.session.interrupt({ sessionID: id })),
        Effect.catchTag(["ACPInvalidRequestError", "SessionNotFoundError"], () => Effect.void),
        Effect.catch(ACPClient.classify),
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

function preparePrompt(catalog: Catalog, parts: readonly PromptPart[], messageID: SessionMessage.ID): PreparedPrompt {
  const visible = parts.filter((part) => part.type !== "text" || (!part.synthetic && !part.ignored))
  const synthetic = parts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : []))
  const text = visible.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const files = visible.flatMap((part) => (part.type === "file" ? [{ uri: part.url, name: part.filename }] : []))
  const slash = detectSlashCommand(text)
  const command = slash ? catalog.commands.find((item) => item.name === slash.name) : undefined
  const start = turnStart(messageID, slash)
  return { start, text, files, synthetic, slash, command }
}

function referenceUnreadableFile(part: PromptPart) {
  if (part.type !== "file" || !part.url.startsWith("file://")) return Effect.succeed(part)
  return Effect.tryPromise(() => access(fileURLToPath(part.url), constants.R_OK)).pipe(
    Effect.as(part),
    Effect.orElseSucceed(() => linkReference(part.filename, part.url)),
  )
}

function turnStart(messageID: SessionMessage.ID, slash: PreparedPrompt["slash"]): ACPTranslate.TurnStart {
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
