export * as Session from "./session.js"

import { DateTime, Deferred, Effect, Fiber, Schema, Scope } from "effect"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Location } from "@opencode-ai/schema/location"
import type { Model } from "@opencode-ai/schema/model"
import { Event } from "@opencode-ai/schema/event"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { PluginActivation } from "@opencode-ai/plugin/effect/activation"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { ShellResult } from "../shell/result.js"
import type { Skill } from "../skill.js"
import {
  BusyError,
  CompactionConflictError,
  ContextDeliveryError,
  InboxConflictError,
  MessageIncompleteError,
  MessageNotAssistantError,
  MessageNotFoundError,
  MessageToolIncompleteError,
  NotFoundError,
  PromptConflictError,
  SyntheticConflictError,
} from "./error.js"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionPrompt } from "./prompt.js"
import { SessionRevert } from "./revert.js"
import { SessionShell } from "./shell.js"
import { SessionSkill } from "./skill.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

type PromptRequest = SessionPrompt.Input & {
  id?: SessionMessage.ID
  resume?: boolean
}

/**
 * Build once in the host Scope: `const sessions = yield* Session.make()`.
 * Use `sessions.forSession(id)` for handles that share host services and reload current state.
 */
export const make = Effect.fn("Session.make")(function* () {
  const bus = yield* Bus.Service
  const database = yield* Database.Service
  const store = yield* SessionStore.Service
  const instances = yield* Instance.Service
  const execution = yield* SessionExecution.Service
  const admission = yield* SessionInbox.Service
  const fs = yield* FSUtil.Service
  const scope = yield* Scope.Scope
  const operationTails = new Map<SessionSchema.ID, { readonly wait: Effect.Effect<void> }>()
  const pluginWaiters = new Map<SessionSchema.ID, Set<Location.Ref>>()
  const promptPreparations = new Map<SessionSchema.ID, Set<PluginActivation.PromptPreparation>>()

  const get = Effect.fn("Session.get")(function* (sessionID: SessionSchema.ID) {
    const session = yield* store.get(sessionID)
    if (!session) return yield* new NotFoundError({ sessionID })
    return session
  })
  const message = Effect.fn("Session.message")(function* (sessionID: SessionSchema.ID, messageID: SessionMessage.ID) {
    const stored = yield* store.message(messageID)
    return stored?.sessionID === sessionID ? stored.message : undefined
  })
  const updateMessage = Effect.fn("Session.updateMessage")(function* (
    sessionID: SessionSchema.ID,
    input: { readonly messageID: SessionMessage.ID; readonly content: readonly SessionMessage.AssistantContent[] },
  ) {
    const ref = { sessionID, messageID: input.messageID }
    yield* get(sessionID)
    if (yield* execution.isActive(sessionID)) return yield* new BusyError({ sessionID })
    const current = yield* message(sessionID, input.messageID)
    if (!current) return yield* new MessageNotFoundError(ref)
    if (current.type !== "assistant") return yield* new MessageNotAssistantError(ref)
    if (!current.time.completed) return yield* new MessageIncompleteError(ref)
    if (input.content.some(isUnfinishedTool)) return yield* new MessageToolIncompleteError(ref)
    yield* bus.publish(SessionEvent.MessageContentUpdated, {
      ...ref,
      content: Schema.encodeSync(Schema.Array(SessionMessage.AssistantContent))(input.content),
    })
    const updated = yield* message(sessionID, input.messageID)
    if (updated?.type !== "assistant") return yield* new MessageNotFoundError(ref)
    return updated
  })
  const view = Effect.fn("Session.view")(function* (sessionID: SessionSchema.ID, input: { idle: number }) {
    const session = yield* get(sessionID)
    if (
      session.time.idle === undefined ||
      input.idle > DateTime.toEpochMillis(session.time.idle) ||
      (session.time.viewed !== undefined && DateTime.toEpochMillis(session.time.viewed) >= input.idle)
    )
      return
    yield* bus.publish(SessionEvent.Viewed, { sessionID, idle: input.idle })
  })
  const rename = Effect.fn("Session.rename")(function* (sessionID: SessionSchema.ID, input: { title: string }) {
    yield* get(sessionID)
    yield* bus.publish(SessionEvent.Renamed, { sessionID, title: input.title })
  })
  const switchAgent = Effect.fn("Session.switchAgent")(function* (
    sessionID: SessionSchema.ID,
    input: { agent: Agent.ID },
  ) {
    const session = yield* get(sessionID)
    if (session.agent === input.agent) return
    yield* bus.publish(SessionEvent.AgentSelected, { sessionID, agent: input.agent, previous: session.agent })
  })
  const switchModel = Effect.fn("Session.switchModel")(function* (
    sessionID: SessionSchema.ID,
    input: { model: Model.Ref },
  ) {
    const session = yield* get(sessionID)
    if (
      session.model?.providerID === input.model.providerID &&
      session.model.id === input.model.id &&
      (session.model.variant ?? "default") === (input.model.variant ?? "default")
    )
      return
    yield* bus.publish(SessionEvent.ModelSelected, { sessionID, model: input.model, previous: session.model })
  })
  const mutatePending = (
    sessionID: SessionSchema.ID,
    inboxID: SessionMessage.ID,
    mutation: (input: {
      readonly id: SessionMessage.ID
      readonly sessionID: SessionSchema.ID
    }) => Effect.Effect<void, SessionInbox.LifecycleConflict>,
  ) =>
    mutation({ sessionID, id: inboxID }).pipe(
      Effect.catchTag("SessionInbox.LifecycleConflict", () =>
        Effect.gen(function* () {
          yield* get(sessionID)
          return yield* new InboxConflictError({ sessionID, inboxID })
        }),
      ),
    )

  const inbox = Effect.fn("Session.inbox")(function* (sessionID: SessionSchema.ID) {
    yield* get(sessionID)
    return yield* admission.list(sessionID)
  })
  const cancelInbox = Effect.fn("Session.cancelInbox")(
    (sessionID: SessionSchema.ID, inboxID: SessionMessage.ID) => mutatePending(sessionID, inboxID, admission.cancel),
    Effect.uninterruptible,
  )
  const steerInbox = Effect.fn("Session.steerInbox")(function* (
    sessionID: SessionSchema.ID,
    inboxID: SessionMessage.ID,
  ) {
    yield* mutatePending(sessionID, inboxID, admission.steer)
    yield* execution.wake(sessionID)
  }, Effect.uninterruptible)
  const queueInbox = Effect.fn("Session.queueInbox")(
    (sessionID: SessionSchema.ID, inboxID: SessionMessage.ID) => mutatePending(sessionID, inboxID, admission.queue),
    Effect.uninterruptible,
  )
  const withSessionReservation = <A, E, R>(
    sessionID: SessionSchema.ID,
    operation: (wait: Effect.Effect<void>) => Effect.Effect<A, E, R>,
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = operationTails.get(sessionID)
        const done = Deferred.makeUnsafe<void>()
        const current = {
          wait: (previous?.wait ?? Effect.void).pipe(Effect.andThen(Deferred.await(done))),
        }
        operationTails.set(sessionID, current)
        return { previous: previous?.wait, done, current }
      }),
      (reservation) => operation(reservation.previous ?? Effect.void),
      (reservation) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(reservation.done, undefined)
          if (operationTails.get(sessionID) !== reservation.current) return
          yield* reservation.current.wait.pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (operationTails.get(sessionID) === reservation.current) operationTails.delete(sessionID)
              }),
            ),
            Effect.forkIn(scope),
          )
        }),
    )
  const withSessionOperation = <A, E, R>(sessionID: SessionSchema.ID, effect: Effect.Effect<A, E, R>) =>
    withSessionReservation(sessionID, (wait) => wait.pipe(Effect.andThen(effect)))
  const withPluginWaiter = <A, E, R>(
    sessionID: SessionSchema.ID,
    location: Location.Ref,
    effect: Effect.Effect<A, E, R>,
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const waiting = pluginWaiters.get(sessionID) ?? new Set<Location.Ref>()
        waiting.add(location)
        pluginWaiters.set(sessionID, waiting)
      }),
      () => effect,
      () =>
        Effect.sync(() => {
          const waiting = pluginWaiters.get(sessionID)
          waiting?.delete(location)
          if (waiting?.size === 0) pluginWaiters.delete(sessionID)
        }),
    )
  const withRevertPlugins = <A, E>(
    sessionID: SessionSchema.ID,
    operation: (session: SessionSchema.Info) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      const session = yield* get(sessionID)
      return yield* withPluginWaiter(
        sessionID,
        session.location,
        Effect.gen(function* () {
          yield* Plugin.awaitActivation
          return yield* SessionInbox.serialized(
            sessionID,
            Effect.gen(function* () {
              const latest = yield* get(sessionID)
              if (
                latest.location.directory !== session.location.directory ||
                latest.location.workspaceID !== session.location.workspaceID
              )
                return { _tag: "retry" as const }
              return { _tag: "done" as const, value: yield* operation(latest) }
            }),
          )
        }).pipe(instances.provide(session)),
      )
    }).pipe(
      Effect.repeat({ while: (result): result is { readonly _tag: "retry" } => result._tag === "retry" }),
      Effect.map((result) => result.value),
    )
  const prompt = Effect.fn("Session.prompt")((sessionID: SessionSchema.ID, input: PromptRequest) =>
    withSessionReservation(sessionID, (wait) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const messageID = input.id ?? SessionMessage.ID.create()
          const checked = yield* SessionInbox.serialized(
            sessionID,
            Effect.gen(function* () {
              const session = yield* get(sessionID)
              const existing = yield* admission.reconcile({
                id: messageID,
                sessionID,
                type: "user",
                delivery: input.delivery ?? "steer",
              })
              if (!existing) return { session, admitted: undefined }
              if (!session.revert) return { session, admitted: existing }
              const retained = yield* store.survivesRevert({
                id: messageID,
                sessionID,
                boundaryID: session.revert.messageID,
              })
              if (!retained) return { session, admitted: undefined }
              return { session, admitted: existing }
            }),
          )
          if (checked.admitted) {
            yield* wait
            const admitted = yield* SessionInbox.serialized(
              sessionID,
              Effect.gen(function* () {
                const session = yield* get(sessionID)
                const existing = yield* admission.reconcile({
                  id: messageID,
                  sessionID,
                  type: "user",
                  delivery: input.delivery ?? "steer",
                })
                if (!existing) return
                if (session.revert) {
                  const retained = yield* store.survivesRevert({
                    id: messageID,
                    sessionID,
                    boundaryID: session.revert.messageID,
                  })
                  if (!retained) return
                  yield* SessionRevert.commit(bus, session)
                }
                if (input.resume !== false) yield* execution.wake(sessionID)
                return existing
              }),
            )
            if (admitted) return admitted
          }
          const prepared = yield* restore(
            withPluginWaiter(
              sessionID,
              checked.session.location,
              Effect.gen(function* () {
                const reservation: PluginActivation.PromptPreparation = {
                  active: true,
                  fiberID: yield* Effect.fiberId,
                  token: {},
                  sessionID,
                  wait,
                }
                return yield* Effect.acquireUseRelease(
                  Effect.sync(() => {
                    const preparations = promptPreparations.get(sessionID) ?? new Set()
                    preparations.add(reservation)
                    promptPreparations.set(sessionID, preparations)
                  }),
                  () =>
                    // prepare awaits plugin activation under its own Instance span.
                    SessionPrompt.prepare({ session: checked.session, messageID, input }).pipe(
                      Effect.provideService(Instance.Service, instances),
                      Effect.provideService(FSUtil.Service, fs),
                      Effect.provideService(PluginActivation.PromptPreparationCurrent, reservation),
                    ),
                  () =>
                    Effect.sync(() => {
                      reservation.active = false
                      const preparations = promptPreparations.get(sessionID)
                      preparations?.delete(reservation)
                      if (preparations?.size === 0) promptPreparations.delete(sessionID)
                    }),
                )
              }),
            ),
          )
          if (input.context && prepared.delivery === "queue") return yield* new ContextDeliveryError({ sessionID })
          const context = input.context
            ? {
                id: input.context.id,
                item: SessionInbox.Item.make({
                  type: "synthetic",
                  payload: SessionInbox.SyntheticPayload.make({
                    text: input.context.text,
                    description: input.context.description,
                    metadata: input.context.metadata,
                  }),
                  delivery: "steer",
                }),
              }
            : undefined
          yield* wait
          return yield* SessionInbox.serialized(
            sessionID,
            Effect.gen(function* () {
              const session = yield* get(sessionID)
              const existing = yield* admission.reconcile({
                id: messageID,
                sessionID,
                type: "user",
                delivery: prepared.delivery,
              })
              if (existing) {
                if (!session.revert) {
                  if (input.resume !== false) yield* execution.wake(sessionID)
                  return existing
                }
                const retained = yield* store.survivesRevert({
                  id: messageID,
                  sessionID,
                  boundaryID: session.revert.messageID,
                })
                if (retained) {
                  yield* SessionRevert.commit(bus, session)
                  if (input.resume !== false) yield* execution.wake(sessionID)
                  return existing
                }
              }
              const enqueued = yield* Effect.gen(function* () {
                if (session.revert) {
                  if (context) {
                    const events = yield* bus.publishAll([
                      [SessionEvent.RevertEvent.Committed, { sessionID, to: session.revert.messageID }],
                      [SessionEvent.InboxEnqueued, { inboxID: context.id, sessionID, item: context.item }],
                      [SessionEvent.InboxEnqueued, { inboxID: messageID, sessionID, item: prepared }],
                    ])
                    return events[2]
                  }
                  const events = yield* bus.publishAll([
                    [SessionEvent.RevertEvent.Committed, { sessionID, to: session.revert.messageID }],
                    [SessionEvent.InboxEnqueued, { inboxID: messageID, sessionID, item: prepared }],
                  ])
                  return events[1]
                }
                if (!context) return undefined
                const events = yield* bus.publishAll([
                  [SessionEvent.InboxEnqueued, { inboxID: context.id, sessionID, item: context.item }],
                  [SessionEvent.InboxEnqueued, { inboxID: messageID, sessionID, item: prepared }],
                ])
                return events[1]
              })
              const recorded = enqueued
                ? SessionInbox.User.make({
                    id: messageID,
                    sessionID,
                    timeCreated: DateTime.makeUnsafe(enqueued.created),
                    type: "user",
                    payload: prepared.payload,
                    delivery: prepared.delivery,
                  })
                : yield* admission.admit({ id: messageID, sessionID, item: prepared })
              if (recorded.type !== "user") return yield* new PromptConflictError({ sessionID, messageID })
              if (input.resume !== false) yield* execution.wake(sessionID)
              return recorded
            }),
          )
        }).pipe(
          Effect.catchTag(
            "SessionInbox.LifecycleConflict",
            (error) => new PromptConflictError({ sessionID, messageID: error.id }),
          ),
          Effect.catchDefect((defect) =>
            defect instanceof SessionInbox.LifecycleConflict
              ? new PromptConflictError({ sessionID, messageID: defect.id })
              : Effect.die(defect),
          ),
        ),
      ),
    ),
  )
  const shell = Effect.fn("Session.shell")(function* (
    sessionID: SessionSchema.ID,
    input: { id?: Event.ID; command: string },
  ) {
    const session = yield* get(sessionID)
    // The server owns completion recording even if the submitting client disconnects.
    const running = yield* Effect.gen(function* () {
      // Plugin-provided shell hooks and configuration only exist after activation.
      yield* Plugin.awaitActivation.pipe(instances.provide(session))
      const started = yield* SessionShell.start({ session, command: input.command }).pipe(
        Effect.provideService(Instance.Service, instances),
        Effect.tapError((error) =>
          synthetic(sessionID, {
            text: `User shell command failed to start:\n${input.command}\n\n${error.message}`,
            description: input.command,
            metadata: { source: "shell", state: "error" },
            resume: false,
          }),
        ),
        Effect.orDie,
      )
      yield* bus.publish(
        SessionEvent.Shell.Started,
        {
          sessionID,
          shell: started.info,
        },
        { id: input.id },
      )
      const terminal = yield* started.result
      const preview = yield* started.output
      yield* bus.publish(SessionEvent.Shell.Ended, {
        sessionID,
        shell: terminal.info,
        output: preview,
      })
      yield* synthetic(sessionID, {
        ...ShellResult.userNotification(terminal),
        resume: false,
      }).pipe(
        Effect.catchTag("Session.NotFoundError", () => Effect.void),
        Effect.orDie,
      )
    }).pipe(Effect.forkIn(scope, { startImmediately: true }))
    yield* Fiber.join(running)
  })
  const skill = Effect.fn("Session.skill")(function* (
    sessionID: SessionSchema.ID,
    input: { id?: SessionMessage.ID; skill: Skill.ID; resume?: boolean },
  ) {
    const session = yield* get(sessionID)
    const skill = yield* SessionSkill.get({ session, skill: input.skill }).pipe(
      Effect.provideService(Instance.Service, instances),
    )
    yield* bus.publish(
      SessionEvent.Skill.Activated,
      {
        sessionID,
        id: skill.id,
        name: skill.name,
        text: skill.content,
      },
      { id: input.id ? Event.ID.make(input.id.replace(/^msg_/, "evt_")) : undefined },
    )
    if (input.resume !== false)
      yield* execution
        .resume(sessionID)
        .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid)
  })
  const compact = Effect.fn("Session.compact")(function* (
    sessionID: SessionSchema.ID,
    input: { id?: SessionMessage.ID; delivery?: SessionInbox.Delivery },
  ) {
    // Commit inside the inbox lock so it cannot interleave with serialized revert
    // mutations; admitCompaction takes the same non-reentrant lock itself.
    yield* SessionInbox.serialized(
      sessionID,
      Effect.gen(function* () {
        const session = yield* get(sessionID)
        if (session.revert) yield* SessionRevert.commit(bus, session)
      }),
    )
    const inputID = input.id ?? SessionMessage.ID.create()
    const admitted = yield* admission
      .admitCompaction({
        id: inputID,
        sessionID,
        delivery: input.delivery ?? "steer",
      })
      .pipe(
        Effect.catchTag("SessionInbox.LifecycleConflict", () => new CompactionConflictError({ sessionID, inputID })),
      )
    yield* execution.wake(sessionID)
    return admitted
  })
  const wait = Effect.fn("Session.wait")(function* (sessionID: SessionSchema.ID) {
    yield* get(sessionID)
    yield* execution.awaitIdle(sessionID)
  })
  const resume = Effect.fn("Session.resume")(function* (sessionID: SessionSchema.ID) {
    yield* get(sessionID)
    yield* execution.resume(sessionID)
  })
  const synthetic = Effect.fn("Session.synthetic")((
    sessionID: SessionSchema.ID,
    input: {
      id?: SessionMessage.ID
      text: string
      description?: string
      metadata?: Record<string, unknown>
      delivery?: SessionInbox.Delivery
      resume?: boolean
    },
  ) => {
    const effect = SessionInbox.serialized(
      sessionID,
      Effect.gen(function* () {
        yield* get(sessionID)
        const inputID = input.id ?? SessionMessage.ID.create()
        const admittedInput = {
          type: "synthetic",
          payload: SessionInbox.SyntheticPayload.make({
            text: input.text,
            description: input.description,
            metadata: input.metadata,
          }),
          delivery: SessionInbox.Delivery.make(input.delivery ?? "steer"),
        } satisfies SessionInbox.Item
        const admitted = yield* admission
          .admit({
            id: inputID,
            sessionID,
            item: admittedInput,
          })
          .pipe(
            Effect.catchTag("SessionInbox.LifecycleConflict", () => new SyntheticConflictError({ sessionID, inputID })),
          )
        if (input.resume !== false && !(yield* get(sessionID)).revert) yield* execution.wake(sessionID)
        return admitted
      }),
    )
    return Effect.uninterruptible(
      Effect.gen(function* () {
        const current = yield* PluginActivation.PromptPreparationCurrent
        const bridgedPreparation = yield* PluginActivation.PromptPreparationBridged
        const preparation =
          current?.active && current.sessionID === sessionID && current.fiberID === (yield* Effect.fiberId)
            ? current
            : Array.from(promptPreparations.get(sessionID) ?? []).find(
                (candidate) => candidate.active && candidate.token === bridgedPreparation,
              )
        if (preparation) {
          yield* preparation.wait
          return yield* effect
        }
        const activation = yield* PluginActivation.Current
        const waiting = pluginWaiters.get(sessionID)
        const bridged = yield* PluginActivation.Bridged
        if (
          activation?.active &&
          (activation.fiberID === (yield* Effect.fiberId) || bridged === activation.token) &&
          Array.from(waiting ?? []).some(
            (location) =>
              location.directory === activation.directory && location.workspaceID === activation.workspaceID,
          )
        )
          return yield* effect
        return yield* withSessionOperation(sessionID, effect)
      }),
    )
  })
  const interrupt = Effect.fn("Session.interrupt")(
    (sessionID: SessionSchema.ID, options?: { readonly continue?: boolean }) =>
      Effect.uninterruptible(execution.interrupt(sessionID, options)),
  )
  const stage = Effect.fn("Session.revert.stage")(function* (
    sessionID: SessionSchema.ID,
    input: { messageID: SessionMessage.ID; files?: boolean },
  ) {
    return yield* withSessionOperation(
      sessionID,
      withRevertPlugins(sessionID, (session) =>
        Effect.gen(function* () {
          if (yield* execution.isActive(sessionID)) return yield* new BusyError({ sessionID })
          return yield* SessionRevert.stage({ session, messageID: input.messageID, files: input.files }).pipe(
            Effect.provideService(Instance.Service, instances),
            Effect.provideService(Database.Service, database),
            Effect.provideService(Bus.Service, bus),
          )
        }),
      ),
    )
  })
  const clear = Effect.fn("Session.revert.clear")(function* (sessionID: SessionSchema.ID) {
    return yield* withSessionOperation(
      sessionID,
      withRevertPlugins(sessionID, (session) =>
        Effect.gen(function* () {
          if (yield* execution.isActive(sessionID)) return yield* new BusyError({ sessionID })
          yield* SessionRevert.clear(session).pipe(
            Effect.provideService(Instance.Service, instances),
            Effect.provideService(Bus.Service, bus),
          )
          return yield* execution.wake(sessionID)
        }),
      ),
    )
  })
  const commit = Effect.fn("Session.revert.commit")(function* (sessionID: SessionSchema.ID) {
    return yield* withSessionOperation(
      sessionID,
      SessionInbox.serialized(
        sessionID,
        Effect.gen(function* () {
          const session = yield* get(sessionID)
          if (yield* execution.isActive(sessionID)) return yield* new BusyError({ sessionID })
          return yield* SessionRevert.commit(bus, session)
        }),
      ),
    )
  })
  const revert = { stage, clear, commit }
  const operations = {
    get,
    message,
    updateMessage,
    view,
    rename,
    switchAgent,
    switchModel,
    inbox,
    prompt,
    synthetic,
    shell,
    skill,
    compact,
    wait,
    resume,
    interrupt,
    cancelInbox,
    steerInbox,
    queueInbox,
    revert,
  }

  const forSession = (sessionID: SessionSchema.ID) => {
    const get = operations.get.bind(undefined, sessionID)
    const message = operations.message.bind(undefined, sessionID)
    const updateMessage = operations.updateMessage.bind(undefined, sessionID)
    const view = operations.view.bind(undefined, sessionID)
    const rename = operations.rename.bind(undefined, sessionID)
    const switchAgent = operations.switchAgent.bind(undefined, sessionID)
    const switchModel = operations.switchModel.bind(undefined, sessionID)
    const inbox = operations.inbox.bind(undefined, sessionID)
    const prompt = operations.prompt.bind(undefined, sessionID)
    const synthetic = operations.synthetic.bind(undefined, sessionID)
    const shell = operations.shell.bind(undefined, sessionID)
    const skill = operations.skill.bind(undefined, sessionID)
    const compact = operations.compact.bind(undefined, sessionID)
    const wait = operations.wait.bind(undefined, sessionID)
    const resume = operations.resume.bind(undefined, sessionID)
    const interrupt = operations.interrupt.bind(undefined, sessionID)
    const cancelInbox = operations.cancelInbox.bind(undefined, sessionID)
    const steerInbox = operations.steerInbox.bind(undefined, sessionID)
    const queueInbox = operations.queueInbox.bind(undefined, sessionID)
    const stage = operations.revert.stage.bind(undefined, sessionID)
    const clear = operations.revert.clear.bind(undefined, sessionID)
    const commit = operations.revert.commit.bind(undefined, sessionID)
    const revert = { stage, clear, commit }

    return {
      id: sessionID,
      get,
      message,
      updateMessage,
      view,
      rename,
      switchAgent,
      switchModel,
      inbox,
      prompt,
      synthetic,
      shell,
      skill,
      compact,
      wait,
      resume,
      interrupt,
      cancelInbox,
      steerInbox,
      queueInbox,
      revert,
    }
  }
  return { forSession }
})

export type Handle = ReturnType<Effect.Success<ReturnType<typeof make>>["forSession"]>

function isUnfinishedTool(content: SessionMessage.AssistantContent) {
  return content.type === "tool" && (content.state.status === "streaming" || content.state.status === "running")
}

// Mirrors the shell tool's in-memory preview safety limit.
