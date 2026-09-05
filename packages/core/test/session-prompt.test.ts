import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Layer, LayerMap, Schema, Stream } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "@opencode-ai/core/bus"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/schema/location"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Image } from "@opencode-ai/core/image"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginActivation } from "@opencode-ai/plugin/effect/activation"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Skill } from "@opencode-ai/core/skill"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const executionCalls: Session.ID[] = []
const interruptCalls: Session.ID[] = []
const interruptContinuations: Array<boolean | undefined> = []
const wakeCalls: Session.ID[] = []
const activeSessions = new Set<Session.ID>()
const wakeControl: {
  started?: Deferred.Deferred<void>
  release?: Deferred.Deferred<void>
  activate?: boolean
} = {}
const pluginFlushHook: { effect: Effect.Effect<void> } = { effect: Effect.void }
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    isActive: (sessionID) => Effect.sync(() => activeSessions.has(sessionID)),
    resume: (sessionID) =>
      Effect.sync(() => {
        executionCalls.push(sessionID)
      }),
    interrupt: (sessionID, options) =>
      Effect.sync(() => {
        interruptCalls.push(sessionID)
        interruptContinuations.push(options?.continue)
        return activeSessions.delete(sessionID)
      }),
    wake: (sessionID) =>
      Effect.gen(function* () {
        wakeCalls.push(sessionID)
        if (wakeControl.started) yield* Deferred.succeed(wakeControl.started, undefined)
        if (wakeControl.release) yield* Deferred.await(wakeControl.release)
        if (wakeControl.activate) activeSessions.add(sessionID)
      }),
    awaitIdle: () => Effect.void,
  }),
)
const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make((_ref: Location.Ref) =>
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.suspend(() => {
          let ready = false
          return Layer.mergeAll(
            LayerNode.compile(LayerNode.group([PluginHooks.node, Skill.node]), {
              replacements: [Bus.node.replace(Layer.succeed(Bus.Service, bus))],
            }),
            Layer.mock(Image.Service, {
              normalize: (_resource, content) =>
                ready
                  ? Effect.succeed(content.content.length > 5 * 1024 * 1024 ? { ...content, content: "AA==" } : content)
                  : Effect.die(new Error("Image service used before plugins were ready")),
            }),
            Layer.mock(Snapshot.Service, {
              capture: () =>
                ready ? Effect.undefined : Effect.die(new Error("Snapshot used before plugins were ready")),
              restore: () => (ready ? Effect.void : Effect.die(new Error("Snapshot used before plugins were ready"))),
            }),
            Layer.mock(Plugin.Service, {
              awaitActivation: Effect.gen(function* () {
                const activation = {
                  active: true,
                  fiberID: yield* Effect.fiberId,
                  token: {},
                  directory: "/project",
                  workspaceID: undefined,
                }
                return yield* Effect.sync(() => (ready = true)).pipe(
                  Effect.andThen(Effect.suspend(() => pluginFlushHook.effect)),
                  Effect.provideService(PluginActivation.Current, activation),
                  Effect.ensuring(Effect.sync(() => (activation.active = false))),
                )
              }),
            }),
          ).pipe(Layer.fresh) as unknown as Layer.Layer<LocationServices>
        }),
      )
    }),
  ),
  deps: [Bus.node],
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(execution),
      LocationServiceMap.node.replace(locations),
    ],
  ),
)
const sessionID = Session.ID.make("ses_prompt_test")
const messageID = SessionMessage.ID.create()

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInbox.find(db, id))
const admittedCount = Database.Service.use(({ db }) =>
  db
    .select()
    .from(SessionInboxTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.length),
    ),
)
const eventCount = (type: string) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(EventTable)
      .where(eq(EventTable.type, type))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const assistantRow = (id: SessionMessage.ID, seq: number) => {
  const {
    id: _,
    type,
    ...data
  } = encodeMessage(
    SessionMessage.Assistant.make({
      id,
      type: "assistant",
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
      content: [],
      time: { created: DateTime.makeUnsafe(0) },
    }),
  )
  return { id, session_id: sessionID, type, seq, time_created: 0, data }
}

describe("Session.prompt", () => {
  it.effect("exposes the execution registry", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      activeSessions.add(sessionID)
      expect(Array.from(yield* session.active)).toEqual([sessionID])
    }).pipe(Effect.ensuring(Effect.sync(() => activeSessions.clear()))),
  )

  it.effect("delegates execution continuation through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("delegates process-local interruption through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      interruptCalls.length = 0
      wakeCalls.length = 0

      expect(yield* session.interrupt(sessionID)).toBeFalse()
      expect(interruptCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
      expect(yield* session.messages({ sessionID })).toEqual([])
    }),
  )

  it.effect("forwards interrupt continuation policy", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      interruptCalls.length = 0
      interruptContinuations.length = 0
      wakeCalls.length = 0

      yield* session.interrupt(sessionID, { continue: true })

      expect(interruptCalls).toEqual([sessionID])
      expect(interruptContinuations).toEqual([true])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("delegates interruption without requiring a recorded Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      interruptCalls.length = 0

      yield* session.interrupt(Session.ID.make("ses_missing"))
      expect(interruptCalls).toEqual([Session.ID.make("ses_missing")])
    }),
  )

  it.effect("durably admits one user message before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service

      const message = yield* session.prompt({
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })

      expect(message.payload.text).toBe("Fix the failing tests")
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).toMatchObject({
        id: message.id,
        sessionID,
        type: "user",
        payload: { text: "Fix the failing tests" },
        delivery: "steer",
      })
    }),
  )

  it.effect("admits synthetic context immediately before its user prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const contextID = SessionMessage.ID.make("msg_prompt_context")
      const promptID = SessionMessage.ID.make("msg_prompt_with_context")

      const prompt = yield* session.prompt({
        id: promptID,
        sessionID,
        text: "Inspect this",
        context: { id: contextID, text: "editor context" },
        resume: false,
      })
      const ignoredContextID = SessionMessage.ID.make("msg_ignored_retry_context")
      const retry = yield* session.prompt({
        id: promptID,
        sessionID,
        text: "ignored retry",
        context: { id: ignoredContextID, text: "ignored context" },
        resume: false,
      })

      expect((yield* session.inbox(sessionID)).map((item) => item.id)).toEqual([contextID, promptID])
      expect(yield* admitted(contextID)).toMatchObject({
        type: "synthetic",
        payload: { text: "editor context" },
      })
      expect(yield* admitted(ignoredContextID)).toBeUndefined()
      expect(retry).toEqual(prompt)
    }),
  )

  it.effect("rejects queued prompts with synthetic context", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const contextID = SessionMessage.ID.make("msg_queued_context")

      const error = yield* session
        .prompt({
          sessionID,
          text: "Queue this",
          context: { id: contextID, text: "editor context" },
          delivery: "queue",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: "Session.ContextDeliveryError", sessionID })
      expect(yield* admittedCount).toBe(0)
    }),
  )

  it.effect("commits a staged revert before admitting a new prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const boundary = yield* session.prompt({
        sessionID,
        text: "boundary",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const stale = SessionMessage.ID.make("msg_stale_assistant")
      yield* db.insert(SessionMessageTable).values(assistantRow(stale, 100)).run().pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      expect((yield* session.get(sessionID)).revert?.messageID).toBe(boundary.id)

      yield* session.prompt({ sessionID, text: "after revert", resume: false })

      expect((yield* session.get(sessionID)).revert).toBeUndefined()
      expect(
        (yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all().pipe(Effect.orDie)).map(
          (row) => row.id,
        ),
      ).not.toContainAnyValues([boundary.id, stale])
      expect(yield* SessionInbox.find(db, boundary.id)).toBeUndefined()
    }),
  )

  it.effect("atomically replaces a staged boundary under the same message ID", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "original", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const stale = SessionMessage.ID.make("msg_stale_same_id_replacement")
      yield* db.insert(SessionMessageTable).values(assistantRow(stale, 100)).run().pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      const context = SessionMessage.ID.make("msg_replacement_context")

      const replacement = yield* session.prompt({
        id: boundary.id,
        sessionID,
        text: "replacement",
        context: { id: context, text: "editor context" },
        delivery: "steer",
        resume: false,
      })
      const retry = yield* session.prompt({
        id: boundary.id,
        sessionID,
        text: "ignored retry",
        delivery: "steer",
        resume: false,
      })
      const rows = yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all().pipe(Effect.orDie)
      const events = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(EventTable.seq)
        .all()
        .pipe(Effect.orDie)

      expect(replacement).toMatchObject({
        id: boundary.id,
        payload: { text: "replacement" },
        delivery: "steer",
      })
      expect(retry).toEqual(replacement)
      expect(rows.map((row) => row.id)).not.toContainAnyValues([boundary.id, stale])
      expect(yield* admitted(boundary.id)).toEqual(replacement)
      expect(yield* admitted(context)).toMatchObject({
        id: context,
        type: "synthetic",
        payload: { text: "editor context" },
      })
      expect(events.slice(-3).map((event) => event.type)).toEqual([
        "session.revert.committed.1",
        "session.inbox.enqueued.1",
        "session.inbox.enqueued.1",
      ])
      expect(yield* eventCount("session.revert.committed.1")).toBe(1)
      expect(yield* eventCount("session.inbox.enqueued.1")).toBe(3)
    }),
  )

  it.effect("commits a staged revert while preserving a delivered retry before the boundary", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const retained = yield* session.prompt({ sessionID, text: "retained", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      const context = SessionMessage.ID.make("msg_ignored_retained_context")

      const retried = yield* session.prompt({
        id: retained.id,
        sessionID,
        text: "ignored retry",
        context: { id: context, text: "ignored context" },
        resume: false,
      })

      expect(retried.payload.text).toBe("retained")
      expect((yield* session.get(sessionID)).revert).toBeUndefined()
      expect((yield* session.messages({ sessionID })).map((message) => message.id)).toEqual([retained.id])
      expect(yield* admitted(context)).toBeUndefined()
    }),
  )

  it.effect("commits a staged revert while preserving a pending retry before the boundary", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const retained = yield* session.prompt({
        sessionID,
        text: "retained",
        delivery: "queue",
        resume: false,
      })
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      const context = SessionMessage.ID.make("msg_ignored_pending_context")

      const retried = yield* session.prompt({
        id: retained.id,
        sessionID,
        text: "ignored retry",
        context: { id: context, text: "ignored context" },
        resume: false,
      })

      expect(retried).toEqual(retained)
      expect((yield* session.get(sessionID)).revert).toBeUndefined()
      expect(yield* admitted(retained.id)).toEqual(retained)
      expect(yield* admitted(context)).toBeUndefined()
    }),
  )

  it.effect("keeps a staged revert recoverable when replacement prompt validation fails", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const stale = SessionMessage.ID.make("msg_stale_after_failed_replacement")
      yield* db.insert(SessionMessageTable).values(assistantRow(stale, 100)).run().pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })

      const error = yield* session
        .prompt({
          sessionID,
          text: "replacement",
          files: [{ uri: "data:image/png;base64,not-base64", name: "image.png" }],
          resume: false,
        })
        .pipe(Effect.flip)
      const rows = yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all().pipe(Effect.orDie)

      expect({
        error: error._tag,
        revert: (yield* session.get(sessionID)).revert?.messageID,
        boundary: rows.some((row) => row.id === boundary.id),
        stale: rows.some((row) => row.id === stale),
        admitted: yield* admittedCount,
      }).toEqual({
        error: "Session.AttachmentError",
        revert: boundary.id,
        boundary: true,
        stale: true,
        admitted: 0,
      })
    }),
  )

  it.effect("keeps a staged revert recoverable when replacement prompt admission conflicts", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const stale = SessionMessage.ID.make("msg_stale_after_conflicting_replacement")
      yield* db.insert(SessionMessageTable).values(assistantRow(stale, 100)).run().pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      const other = Session.ID.make("ses_prompt_conflict")
      yield* db
        .insert(SessionTable)
        .values({
          id: other,
          project_id: Project.ID.global,
          slug: "conflict",
          directory: "/project",
          title: "conflict",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const conflict = SessionMessage.ID.create()
      yield* session.prompt({ id: conflict, sessionID: other, text: "first", resume: false })
      const context = SessionMessage.ID.make("msg_context_before_conflict")

      const error = yield* session
        .prompt({
          id: conflict,
          sessionID,
          text: "replacement",
          context: { id: context, text: "editor context" },
          resume: false,
        })
        .pipe(Effect.flip)
      const rows = yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all().pipe(Effect.orDie)

      expect({
        error: error._tag,
        revert: (yield* session.get(sessionID)).revert?.messageID,
        boundary: rows.some((row) => row.id === boundary.id),
        stale: rows.some((row) => row.id === stale),
        context: yield* admitted(context),
      }).toEqual({
        error: "Session.PromptConflictError",
        revert: boundary.id,
        boundary: true,
        stale: true,
        context: undefined,
      })
    }),
  )

  it.effect("serializes revert staging before replacement prompt admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const locked = yield* SessionInbox.serialized(
        sessionID,
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)

      const staged = yield* session.revert
        .stage({ sessionID, messageID: boundary.id, files: false })
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const replacementID = SessionMessage.ID.make("msg_serialized_replacement")
      const prompted = yield* session
        .prompt({ id: replacementID, sessionID, text: "replacement", resume: false })
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(yield* admitted(replacementID)).toBeUndefined()
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(locked)
      yield* Fiber.join(staged)
      const replacement = yield* Fiber.join(prompted)

      expect((yield* session.get(sessionID)).revert).toBeUndefined()
      expect(replacement.payload.text).toBe("replacement")
      expect(yield* admitted(replacementID)).toEqual(replacement)
    }),
  )

  it.effect("starts execution before a waiting revert can stage", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      wakeControl.started = started
      wakeControl.release = release
      wakeControl.activate = true

      return yield* Effect.gen(function* () {
        const prompted = yield* session.prompt({ sessionID, text: "replacement" }).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const staged = yield* session.revert
          .stage({ sessionID, messageID: boundary.id, files: false })
          .pipe(Effect.flip, Effect.forkChild)
        yield* Effect.yieldNow

        expect(staged.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(release, undefined)
        const replacement = yield* Fiber.join(prompted)
        const error = yield* Fiber.join(staged)

        expect(error._tag).toBe("Session.BusyError")
        expect(yield* admitted(replacement.id)).toEqual(replacement)
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(release, undefined).pipe(
            Effect.andThen(
              Effect.sync(() => {
                delete wakeControl.started
                delete wakeControl.release
                delete wakeControl.activate
                activeSessions.clear()
              }),
            ),
          ),
        ),
      )
    }),
  )

  it.effect("reserves revert staging before delayed plugin activation", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      pluginFlushHook.effect = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))

      yield* Effect.gen(function* () {
        const staged = yield* session.revert
          .stage({ sessionID, messageID: boundary.id, files: false })
          .pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const replacementID = SessionMessage.ID.make("msg_delayed_stage_replacement")
        const prompted = yield* session
          .prompt({ id: replacementID, sessionID, text: "replacement", resume: false })
          .pipe(Effect.forkChild)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )

        const promptBeforeRelease = prompted.pollUnsafe()
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(staged)
        const replacement = yield* Fiber.join(prompted)

        expect(promptBeforeRelease).toBeUndefined()
        expect((yield* session.get(sessionID)).revert).toBeUndefined()
        expect(replacement.payload.text).toBe("replacement")
        expect(yield* admitted(replacementID)).toEqual(replacement)
      }).pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))
    }),
  )

  it.effect("reserves revert clearing before delayed plugin activation", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const retained = yield* session.prompt({ sessionID, text: "retained", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      yield* session.revert.stage({ sessionID, messageID: boundary.id, files: false })
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      pluginFlushHook.effect = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))

      yield* Effect.gen(function* () {
        const cleared = yield* session.revert.clear(sessionID).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const replacementID = SessionMessage.ID.make("msg_delayed_clear_replacement")
        const prompted = yield* session
          .prompt({ id: replacementID, sessionID, text: "after clear", resume: false })
          .pipe(Effect.forkChild)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )

        const promptBeforeRelease = prompted.pollUnsafe()
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(cleared)
        yield* Fiber.join(prompted)

        expect(promptBeforeRelease).toBeUndefined()
        expect((yield* session.get(sessionID)).revert).toBeUndefined()
        expect((yield* session.messages({ sessionID, order: "asc" })).map((message) => message.id)).toEqual([
          retained.id,
          boundary.id,
        ])
        expect(yield* admitted(replacementID)).toMatchObject({ id: replacementID, payload: { text: "after clear" } })
      }).pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))
    }),
  )

  it.effect("reserves file prompt admission before a later revert stage", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let flushes = 0
      pluginFlushHook.effect = Effect.suspend(() => {
        flushes++
        if (flushes > 1) return Effect.void
        return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      const uri =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

      yield* Effect.gen(function* () {
        const prompted = yield* session
          .prompt({ sessionID, text: "inspect", files: [{ uri }], resume: false })
          .pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const staged = yield* session.revert
          .stage({ sessionID, messageID: boundary.id, files: false })
          .pipe(Effect.forkChild)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )

        const stageBeforeRelease = staged.pollUnsafe()
        const flushesBeforeRelease = flushes
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(prompted)
        yield* Fiber.join(staged)

        expect(stageBeforeRelease).toBeUndefined()
        expect(flushesBeforeRelease).toBe(1)
        expect((yield* session.get(sessionID)).revert?.messageID).toBe(boundary.id)
      }).pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))
    }),
  )

  it.effect("keeps later operations behind a failed middle reservation", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const firstEntered = yield* Deferred.make<void>()
      const secondEntered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let flushes = 0
      pluginFlushHook.effect = Effect.suspend(() => {
        flushes++
        if (flushes === 1)
          return Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        if (flushes === 2)
          return Deferred.succeed(secondEntered, undefined).pipe(
            Effect.andThen(Effect.die(new Error("middle preparation failed"))),
          )
        return Effect.void
      })

      yield* Effect.gen(function* () {
        const first = yield* session.prompt({ sessionID, text: "first", resume: false }).pipe(Effect.forkChild)
        yield* Deferred.await(firstEntered)
        const middle = yield* session.prompt({ sessionID, text: "middle", resume: false }).pipe(Effect.forkChild)
        yield* Deferred.await(secondEntered)
        const lastID = SessionMessage.ID.make("msg_after_failed_reservation")
        const last = yield* session
          .prompt({ id: lastID, sessionID, text: "last", resume: false })
          .pipe(Effect.forkChild)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )

        expect(last.pollUnsafe()).toBeUndefined()
        expect(yield* admitted(lastID)).toBeUndefined()
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        expect((yield* Fiber.await(middle))._tag).toBe("Failure")
        expect(yield* Fiber.join(last)).toMatchObject({ id: lastID, payload: { text: "last" } })
      }).pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))
    }),
  )

  it.effect("interrupts a middle reservation without releasing later operations", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const firstEntered = yield* Deferred.make<void>()
      const middleEntered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let flushes = 0
      pluginFlushHook.effect = Effect.suspend(() => {
        flushes++
        if (flushes === 1)
          return Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        if (flushes === 2) return Deferred.succeed(middleEntered, undefined).pipe(Effect.andThen(Effect.never))
        return Effect.void
      })

      yield* Effect.gen(function* () {
        const first = yield* session.prompt({ sessionID, text: "first", resume: false }).pipe(Effect.forkChild)
        yield* Deferred.await(firstEntered)
        const middle = yield* session.prompt({ sessionID, text: "middle", resume: false }).pipe(Effect.forkChild)
        yield* Deferred.await(middleEntered)
        const lastID = SessionMessage.ID.make("msg_after_interrupted_reservation")
        const last = yield* session
          .prompt({ id: lastID, sessionID, text: "last", resume: false })
          .pipe(Effect.forkChild)

        yield* Fiber.interrupt(middle).pipe(Effect.timeout("1 second"))
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )
        expect(last.pollUnsafe()).toBeUndefined()
        expect(yield* admitted(lastID)).toBeUndefined()
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        expect(yield* Fiber.join(last)).toMatchObject({ id: lastID, payload: { text: "last" } })
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(release, undefined).pipe(
            Effect.andThen(Effect.sync(() => (pluginFlushHook.effect = Effect.void))),
          ),
        ),
      )
    }),
  )

  it.effect("holds synthetic input behind a staged revert and discards it when committed", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({
        sessionID,
        text: "boundary",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      wakeCalls.length = 0

      const completion = yield* session.synthetic({ sessionID, text: "stale completion" })

      expect(wakeCalls).toEqual([])
      expect(yield* SessionInbox.find(db, completion.id)).toMatchObject({ type: "synthetic" })

      yield* session.revert.commit(sessionID)

      expect(yield* SessionInbox.find(db, completion.id)).toBeUndefined()
    }),
  )

  it.effect("serializes synthetic admission with revert mutations", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const locked = yield* SessionInbox.serialized(
        sessionID,
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const synthetic = yield* session
        .synthetic({
          id: SessionMessage.ID.make("msg_serialized_synthetic"),
          sessionID,
          text: "completion",
          resume: false,
        })
        .pipe(Effect.forkChild)
      yield* Effect.all(
        Array.from({ length: 10 }, () => Effect.yieldNow),
        { concurrency: 1 },
      )

      expect(synthetic.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(locked)
      expect((yield* Fiber.join(synthetic)).payload.text).toBe("completion")
    }),
  )

  it.effect("does not hold the inbox lock while image plugins activate", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      pluginFlushHook.effect = session
        .synthetic({ sessionID, text: "plugin activated", resume: false })
        .pipe(Effect.orDie, Effect.asVoid)

      yield* Effect.gen(function* () {
        const prompt = yield* session
          .prompt({ sessionID, text: "Inspect this image", files: [{ uri }], resume: false })
          .pipe(Effect.forkChild)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )
        expect(prompt.pollUnsafe()).toBeDefined()
        yield* Fiber.join(prompt)
      }).pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))
    }),
  )

  it.effect("expires plugin activation bypass for detached work", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const trigger = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<void>()
      pluginFlushHook.effect = Deferred.await(trigger).pipe(
        Effect.andThen(session.synthetic({ sessionID, text: "detached activation", resume: false })),
        Effect.andThen(Deferred.succeed(completed, undefined)),
        Effect.forkDetach,
        Effect.asVoid,
      )
      const uri =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

      yield* session.prompt({ sessionID, text: "Inspect this image", files: [{ uri }], resume: false })
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      pluginFlushHook.effect = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))

      yield* Effect.gen(function* () {
        const staged = yield* session.revert
          .stage({ sessionID, messageID: boundary.id, files: false })
          .pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        yield* Deferred.succeed(trigger, undefined)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )
        const completedBeforeRelease = yield* Deferred.isDone(completed)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(staged)
        yield* Deferred.await(completed)

        expect(completedBeforeRelease).toBe(false)
      }).pipe(
        Effect.ensuring(
          Effect.all([Deferred.succeed(trigger, undefined), Deferred.succeed(release, undefined)], {
            discard: true,
          }).pipe(Effect.andThen(Effect.sync(() => (pluginFlushHook.effect = Effect.void)))),
        ),
      )
    }),
  )

  it.effect("does not grant plugin activation bypass to detached work", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({ sessionID, text: "boundary", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<void>()
      pluginFlushHook.effect = Deferred.succeed(attempted, undefined).pipe(
        Effect.andThen(session.synthetic({ sessionID, text: "detached activation", resume: false })),
        Effect.andThen(Deferred.succeed(completed, undefined)),
        Effect.forkDetach({ startImmediately: true }),
        Effect.andThen(Deferred.succeed(entered, undefined)),
        Effect.andThen(Deferred.await(release)),
        Effect.asVoid,
      )

      yield* Effect.gen(function* () {
        const staged = yield* session.revert
          .stage({ sessionID, messageID: boundary.id, files: false })
          .pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        yield* Deferred.await(attempted)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )
        const completedBeforeRelease = yield* Deferred.isDone(completed)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(staged)
        yield* Deferred.await(completed)

        expect(completedBeforeRelease).toBe(false)
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(release, undefined).pipe(
            Effect.andThen(Effect.sync(() => (pluginFlushHook.effect = Effect.void))),
          ),
        ),
      )
    }),
  )

  it.effect("resolves attachment MIME before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri, name: "image.png", mention: { start: 8, end: 17, text: "[Image 1]" } }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: uri.slice(uri.indexOf(",") + 1),
          mime: "image/png",
          source: { type: "inline" },
          name: "image.png",
          mention: { start: 8, end: 17, text: "[Image 1]" },
        },
      ])
      const stored = yield* admitted(message.id)
      expect(stored?.type).toBe("user")
      if (stored?.type === "user") expect(stored.payload.files).toEqual(message.payload.files)
    }),
  )

  it.effect("materializes selected source file content", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const directory = import.meta.dir
      const source = path.join(directory, "session-prompt.test.ts")
      const sourceUri = pathToFileURL(source)
      sourceUri.searchParams.set("start", "1")
      sourceUri.searchParams.set("end", "1")

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri: sourceUri.href, name: "main.ts" }],
        resume: false,
      })

      expect(message.payload.files).toHaveLength(1)
      expect(message.payload.files?.[0]).toMatchObject({
        mime: "text/plain",
        source: { type: "uri", uri: sourceUri.href },
        name: "main.ts",
      })
      expect(
        Buffer.from(message.payload.files?.[0]?.data ?? "", "base64")
          .toString("utf8")
          .replace(/\r$/, ""),
      ).toBe('import { describe, expect } from "bun:test"')
    }),
  )

  it.effect("materializes directories as directory attachments", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri = pathToFileURL(import.meta.dir).href

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri, name: "source" }],
        resume: false,
      })

      expect(message.payload.files).toHaveLength(1)
      expect(message.payload.files?.[0]).toMatchObject({
        mime: "application/x-directory",
        source: { type: "uri", uri },
        name: "source",
      })
      expect(Buffer.from(message.payload.files?.[0]?.data ?? "", "base64").toString("utf8")).toContain(
        "session-prompt.test.ts",
      )
    }),
  )

  it.effect("materializes local image content before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const directory = yield* tmpdirScoped("opencode-session-prompt-")
      const source = path.join(directory.path, "image.png")
      const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      )
      yield* Effect.promise(() => Bun.write(source, bytes))

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri: pathToFileURL(source).href }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: bytes.toString("base64"),
          mime: "image/png",
          source: { type: "uri", uri: pathToFileURL(source).href },
          name: "image.png",
        },
      ])
      const stored = yield* admitted(message.id)
      expect(stored?.type === "user" ? stored.payload.files : undefined).toEqual(message.payload.files)
    }),
  )

  it.effect("normalizes large image content before validating persisted Base64", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const pixel = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      )
      const bytes = Buffer.concat([pixel, Buffer.alloc(4_323_030 - pixel.length)])
      const data = bytes.toString("base64")
      expect(data).toHaveLength(5_764_040)

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri: `data:image/png;base64,${data}` }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: "AA==",
          mime: "image/png",
          source: { type: "inline" },
        },
      ])
    }),
  )

  it.effect("sniffs data URL content instead of trusting its declared MIME", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri = `data:video/mp2t;base64,${Buffer.from("export const value = 1\n").toString("base64")}`

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri, name: "main.ts" }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: Buffer.from("export const value = 1\n").toString("base64"),
          mime: "text/plain",
          source: { type: "inline" },
          name: "main.ts",
        },
      ])
    }),
  )

  it.effect("rejects malformed base64 data URLs", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri = "data:image/png;base64,not-base64"

      const error = yield* session
        .prompt({
          sessionID,
          text: "Inspect this",
          files: [{ uri, name: "image.png" }],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(error).toMatchObject({
        _tag: "Session.AttachmentError",
        uri,
        message: "Invalid attachment data URL",
      })
    }),
  )

  it.effect("streams durable Session events after an aggregate sequence", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const publicEvents = (input: { sessionID: Session.ID; after?: number }) =>
        session
          .log({ ...input, follow: true })
          .pipe(Stream.filter((item): item is SessionEvent.DurableEvent => !Bus.isSynced(item)))
      const fiber = yield* publicEvents({ sessionID }).pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.prompt({ sessionID, text: "First", resume: false })
      yield* session.prompt({ sessionID, text: "Second", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const streamed = Array.from(yield* Fiber.join(fiber))

      expect(streamed.map((event): [number | undefined, string] => [event.durable?.seq, event.type])).toEqual([
        [0, "session.inbox.enqueued"],
        [1, "session.inbox.enqueued"],
        [2, "session.inbox.delivered"],
        [3, "session.inbox.delivered"],
      ])
      expect(
        Array.from(
          yield* publicEvents({ sessionID, after: streamed[0].durable?.seq }).pipe(Stream.take(1), Stream.runCollect),
        ).map((event): [number | undefined, string] => [event.durable?.seq, event.type]),
      ).toEqual([[1, "session.inbox.enqueued"]])
    }),
  )

  it.effect("resumes through a recorded message without appending another prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const message = yield* session.prompt({
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })

      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect((yield* session.inbox(sessionID)).map((item) => item.id)).toEqual([message.id])
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("records distinct messages when the ID is omitted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = { sessionID, text: "Fix the failing tests", resume: false }

      const first = yield* session.prompt(input)
      const second = yield* session.prompt(input)

      expect(second.id).not.toBe(first.id)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(2)
    }),
  )

  it.effect("returns the original recorded message when the ID is retried", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("reconciles file-bearing retries before loading location plugins", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const id = SessionMessage.ID.create()
      const original = yield* session.prompt({ id, sessionID, text: "First admission", resume: false })
      pluginFlushHook.effect = Effect.die(new Error("plugins loaded for a durable retry"))

      const retried = yield* session
        .prompt({
          id,
          sessionID,
          text: "Ignored retry",
          files: [{ uri: "data:image/png;base64,invalid" }],
          resume: false,
        })
        .pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))

      expect(retried).toEqual(original)
    }),
  )

  it.effect("reconciles a queued durable retry before prompt preparation", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const id = SessionMessage.ID.create()
      const original = yield* session.prompt({ id, sessionID, text: "First admission", resume: false })
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let flushes = 0
      pluginFlushHook.effect = Effect.suspend(() => {
        flushes++
        if (flushes === 1) return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        return Effect.die(new Error("plugins loaded for a queued durable retry"))
      })

      yield* Effect.gen(function* () {
        const pending = yield* session.prompt({ sessionID, text: "Unrelated", resume: false }).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const retried = yield* session
          .prompt({
            id,
            sessionID,
            text: "Ignored retry",
            files: [{ uri: "data:image/png;base64,invalid" }],
            resume: false,
          })
          .pipe(Effect.forkChild)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )

        expect(retried.pollUnsafe()).toBeUndefined()
        expect(flushes).toBe(1)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(pending)
        expect(yield* Fiber.join(retried)).toEqual(original)
      }).pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))
    }),
  )

  it.effect("reconciles an exact retry from the promoted message without admission history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const input = { sessionID, id: messageID, text: "Fix the failing tests", resume: false }
      const first = yield* session.prompt(input)
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, sessionID)).run().pipe(Effect.orDie)

      const retried = yield* session.prompt(input)

      expect(retried).toMatchObject({ id: first.id, type: "user", payload: { text: first.payload.text } })
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: messageID, type: "user", text: "Fix the failing tests" },
      ])
    }),
  )

  it.effect("ignores delivery when retrying a promoted message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const input = { sessionID, id: messageID, text: "Fix the failing tests", resume: false }
      yield* session.prompt(input)
      yield* SessionInbox.promote(db, bus, sessionID, "steer")

      const retried = yield* session.prompt({ ...input, delivery: "queue" })

      expect(retried).toMatchObject({ id: messageID, type: "user", payload: { text: input.text } })
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("wakes execution when an exact prompt retry recovers a committed message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Recover committed prompt",
        resume: false,
      }
      const first = yield* session.prompt(input)
      wakeCalls.length = 0

      const retried = yield* session.prompt({ ...input, resume: true })

      expect(retried).toEqual(first)
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("keeps the first admission when one ID is reused with a different prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service

      const first = yield* session.prompt({
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
      })
      const retried = yield* session.prompt({
        sessionID,
        id: messageID,
        text: "Delete the failing tests",
        resume: false,
      })

      expect(retried).toEqual(first)
      expect(retried.payload.text).toBe("Fix the failing tests")
      expect(yield* session.messages({ sessionID })).toHaveLength(0)
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("keeps the first admission's delivery mode when one ID is reused with another", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service

      const first = yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })
      const retried = yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Fix the failing tests",
        delivery: "queue",
        resume: false,
      })

      expect(retried).toEqual(first)
      expect(retried.delivery).toBe("steer")
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("returns one recorded message to concurrent exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
        resume: false,
      }

      const messages = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(messages[1]).toEqual(messages[0])
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxEnqueued.type, 1))).toBe(1)
    }),
  )

  it.effect("promotes one message once under concurrent promotion attempts", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Promote once",
        resume: false,
      })

      yield* Effect.all(
        [SessionInbox.promote(db, bus, sessionID, "steer"), SessionInbox.promote(db, bus, sessionID, "steer")],
        { concurrency: "unbounded" },
      )

      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDelivered.type, 1))).toBe(1)
      expect(yield* admitted(messageID)).toBeUndefined()
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: messageID, type: "user", text: "Promote once" },
      ])
    }),
  )

  it.effect("reprojects pending inbox input without scheduling execution", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      wakeCalls.length = 0
      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Replay pending",
        resume: false,
      })
      const syntheticID = SessionMessage.ID.create()
      yield* session.synthetic({ id: syntheticID, sessionID, text: "Replay synthetic", resume: false })
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)

      yield* bus.remove(sessionID)
      yield* db.delete(SessionInboxTable).where(eq(SessionInboxTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        recorded.map((event) => ({
          id: event.id,
          created: event.created,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
        (event) => bus.replay(event),
        { discard: true },
      )

      expect(yield* admitted(messageID)).toMatchObject({
        id: messageID,
        type: "user",
        payload: { text: "Replay pending" },
      })
      expect(yield* admitted(syntheticID)).toMatchObject({
        id: syntheticID,
        type: "synthetic",
        payload: { text: "Replay synthetic" },
      })
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("rejects reuse of one globally unique message ID across sessions", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      const other = Session.ID.make("ses_prompt_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: other,
          project_id: Project.ID.global,
          slug: "other",
          directory: "/project",
          title: "other",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* session.prompt({ id: messageID, sessionID, text: "Fix the failing tests", resume: false })
      const contextID = SessionMessage.ID.make("msg_cross_session_context")
      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID: other,
          text: "Fix the failing tests",
          context: { id: contextID, text: "editor context" },
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID: other, messageID })
      expect(yield* admitted(contextID)).toBeUndefined()
    }),
  )

  it.effect("rejects a prompt ID already used by visible Session history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const {
        id: _,
        type,
        ...data
      } = encodeMessage({
        id: messageID,
        type: "synthetic",
        text: "Existing history",
        time: { created: DateTime.makeUnsafe(0) },
      })
      yield* db
        .insert(SessionMessageTable)
        .values({ id: messageID, session_id: sessionID, type, seq: 0, time_created: 0, data })
        .run()
        .pipe(Effect.orDie)

      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          text: "Conflicting prompt",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID, messageID })
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("starts execution by default after recording the prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, text: "Run by default" })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("starts execution when resume is explicitly true", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({
        sessionID,
        text: "Run explicitly",
        resume: true,
      })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("only records the prompt when resume is false", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, text: "Do not run", resume: false })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("keeps the first admission's metadata when one ID is reused with other metadata", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        id: messageID,
        sessionID,
        text: "Deploy",
        metadata: { source: "api" },
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)
      const differing = yield* session.prompt({ ...input, metadata: { source: "plugin" } })

      expect(retried).toEqual(first)
      expect(differing).toEqual(first)
      expect(first.payload.metadata).toEqual({ source: "api" })
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("durably admits synthetic input before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const input = yield* session.synthetic({
        id: messageID,
        sessionID,
        text: "Background work completed",
        description: "shell completion",
        metadata: { job: "shell" },
        resume: false,
      })

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(input.id)).toMatchObject({
        type: "synthetic",
        sessionID,
        delivery: "steer",
        payload: {
          text: "Background work completed",
          description: "shell completion",
          metadata: { job: "shell" },
        },
      })

      yield* SessionInbox.promote(db, bus, sessionID, "steer")

      expect(yield* session.messages({ sessionID })).toMatchObject([
        {
          id: messageID,
          type: "synthetic",
          text: "Background work completed",
          description: "shell completion",
          metadata: { job: "shell" },
        },
      ])
    }),
  )

  it.effect("reconciles synthetic retries from the promoted message regardless of payload", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const input = { id: messageID, sessionID, text: "Completed", resume: false }

      const entries = yield* Effect.all([session.synthetic(input), session.synthetic(input)], {
        concurrency: "unbounded",
      })
      yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
      const promotedRetry = yield* session.synthetic(input)
      const differing = yield* session.synthetic({ ...input, text: "Different completion" })

      expect(entries[1]).toEqual(entries[0])
      expect(promotedRetry).toMatchObject({ id: messageID, type: "synthetic", payload: { text: "Completed" } })
      expect(differing).toMatchObject({ id: messageID, type: "synthetic", payload: { text: "Completed" } })
      expect(yield* admittedCount).toBe(0)
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxEnqueued.type, 1))).toBe(1)
    }),
  )

  it.effect("keeps queued input pending until the idle boundary", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const input = yield* session.synthetic({
        sessionID,
        text: "Queued completion",
        delivery: "queue",
        resume: false,
      })

      expect(input.delivery).toBe("queue")
      expect(yield* SessionInbox.has(db, sessionID, "input")).toBe(true)
      expect(yield* SessionInbox.promote(db, bus, sessionID, "steer")).toBe(0)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* SessionInbox.promote(db, bus, sessionID, "input")).toBe(1)
      expect(yield* SessionInbox.has(db, sessionID, "input")).toBe(false)
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: input.id, type: "synthetic", text: "Queued completion" },
      ])
    }),
  )

  it.effect("promotes prompt and synthetic steers in admission order", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      yield* session.prompt({
        sessionID,
        text: "First prompt",
        resume: false,
      })
      yield* session.synthetic({ sessionID, text: "Background completion", resume: false })
      yield* session.prompt({
        sessionID,
        text: "Second prompt",
        resume: false,
      })

      yield* SessionInbox.promote(db, bus, sessionID, "steer")

      expect(
        (yield* session.messages({ sessionID, order: "asc" })).map((message) =>
          message.type === "user" || message.type === "synthetic" ? message.text : message.type,
        ),
      ).toEqual(["First prompt", "Background completion", "Second prompt"])
    }),
  )
})

describe("Session.revert", () => {
  it.effect("does not hold the inbox lock while location plugins activate", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      yield* db.insert(SessionMessageTable).values(assistantRow(messageID, 0)).run().pipe(Effect.orDie)
      pluginFlushHook.effect = session
        .synthetic({ sessionID, text: "plugin activated", resume: false })
        .pipe(Effect.orDie, Effect.asVoid)

      yield* Effect.gen(function* () {
        const stage = yield* session.revert.stage({ sessionID, messageID }).pipe(Effect.forkChild)
        yield* Effect.all(
          Array.from({ length: 10 }, () => Effect.yieldNow),
          { concurrency: 1 },
        )
        expect(stage.pollUnsafe()).toBeDefined()
        yield* Fiber.join(stage)
      }).pipe(Effect.ensuring(Effect.sync(() => (pluginFlushHook.effect = Effect.void))))
    }),
  )

  it.effect("waits for location plugins before staging", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      yield* db.insert(SessionMessageTable).values(assistantRow(messageID, 0)).run().pipe(Effect.orDie)
      yield* session.revert.stage({ sessionID, messageID })
    }),
  )

  it.effect("waits for location plugins before clearing", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID, snapshot: Snapshot.ID.make("tree"), files: [] },
      })
      yield* session.revert.clear(sessionID)
    }),
  )
})

describe("Session.inbox", () => {
  it.effect("fails for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      expect(yield* session.inbox(Session.ID.make("ses_missing")).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
      })
    }),
  )

  it.effect("lists admitted work in admission order until promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const first = yield* session.prompt({ sessionID, text: "First steer", resume: false })
      const queued = yield* session.synthetic({
        sessionID,
        text: "Queued completion",
        delivery: "queue",
        resume: false,
      })
      const second = yield* session.prompt({ sessionID, text: "Second steer", resume: false })

      expect(yield* session.inbox(sessionID)).toMatchObject([
        { id: first.id, type: "user", delivery: "steer" },
        { id: queued.id, type: "synthetic", delivery: "queue" },
        { id: second.id, type: "user", delivery: "steer" },
      ])

      expect(yield* SessionInbox.promote(db, bus, sessionID, "input")).toBe(2)
      expect(yield* session.inbox(sessionID)).toMatchObject([{ id: queued.id, type: "synthetic" }])

      expect(yield* SessionInbox.promote(db, bus, sessionID, "input")).toBe(1)
      expect(yield* session.inbox(sessionID)).toEqual([])
    }),
  )

  it.effect("lists an unhandled compaction until it is cancelled", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const { db } = yield* Database.Service

      const barrier = yield* session.compact({ sessionID })
      expect(yield* SessionInbox.has(db, sessionID, "input")).toBe(true)
      expect(yield* session.inbox(sessionID)).toMatchObject([{ id: barrier.id, type: "compaction" }])

      yield* session.cancelInbox({ sessionID, inboxID: barrier.id })
      expect(yield* SessionInbox.has(db, sessionID, "input")).toBe(false)
      expect(yield* session.inbox(sessionID)).toEqual([])
    }),
  )

  it.effect("cancels pending input and allows its ID to be admitted again", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const inputID = SessionMessage.ID.make("msg_cancelled_queue")
      yield* session.prompt({
        id: inputID,
        sessionID,
        text: "Queue this",
        delivery: "queue",
        resume: false,
      })

      yield* session.cancelInbox({ sessionID, inboxID: inputID })

      expect(yield* session.inbox(sessionID)).toEqual([])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxCancelled.type, 1))).toBe(1)
      expect(yield* session.cancelInbox({ sessionID, inboxID: inputID }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.InboxConflictError",
        sessionID,
        inboxID: inputID,
      })
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxCancelled.type, 1))).toBe(1)

      const retried = yield* session.prompt({
        id: inputID,
        sessionID,
        text: "Queue this",
        delivery: "queue",
        resume: false,
      })
      expect(retried).toMatchObject({ id: inputID, delivery: "queue" })
    }),
  )

  it.effect("moves pending input between steer and queue delivery", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const queued = yield* session.synthetic({
        sessionID,
        text: "Steer this",
        delivery: "queue",
        resume: false,
      })
      const alreadySteered = yield* session.prompt({ sessionID, text: "Already steer", resume: false })
      wakeCalls.length = 0

      yield* session.steerInbox({ sessionID, inboxID: queued.id })

      expect(yield* session.inbox(sessionID)).toMatchObject([
        { id: queued.id, delivery: "steer" },
        { id: alreadySteered.id, delivery: "steer" },
      ])
      expect(wakeCalls).toEqual([sessionID])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDeliveryChanged.type, 1))).toBe(1)

      wakeCalls.length = 0
      yield* session.queueInbox({ sessionID, inboxID: queued.id })
      expect(yield* session.inbox(sessionID)).toMatchObject([
        { id: queued.id, delivery: "queue" },
        { id: alreadySteered.id, delivery: "steer" },
      ])
      expect(wakeCalls).toEqual([])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDeliveryChanged.type, 1))).toBe(2)

      expect(yield* session.steerInbox({ sessionID, inboxID: alreadySteered.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.InboxConflictError",
        sessionID,
        inboxID: alreadySteered.id,
      })
      yield* session.cancelInbox({ sessionID, inboxID: alreadySteered.id })
      expect(wakeCalls).toEqual([])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDeliveryChanged.type, 1))).toBe(2)
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxCancelled.type, 1))).toBe(1)
    }),
  )
})
