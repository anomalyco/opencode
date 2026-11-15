import { describe, expect } from "bun:test"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import type { FileSystem } from "@opencode/core/filesystem"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { EventTable } from "@opencode/core/event/sql"
import { Flag } from "@opencode/core/flag"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionCompaction } from "@opencode/core/session/compaction"
import { SessionContext } from "@opencode/core/session/context"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionIdleCompaction } from "@opencode/core/session/idle-compaction"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionPresence } from "@opencode/core/session/presence"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Agent } from "@opencode/core/agent"
import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { DateTime, Effect, Layer, LayerMap, Schema } from "effect"
import { TestClock } from "effect/testing"
import { eq } from "drizzle-orm"
import { drain } from "./lib/clock"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const model = LanguageModel.make({ id: "summary-model", provider: "test", route: OpenAIChat.route })

let modelCache: Provider.Cache | undefined = { ttl: "5m" }
let nativeCompaction = false
let resolveError = false
let autoEnabled = true
const resolveFixture = () =>
  resolveError
    ? Effect.fail(
        new SessionRunnerModel.ModelUnavailableError({
          providerID: Provider.ID.make("test"),
          modelID: Model.ID.make("summary-model"),
        }),
      )
    : Effect.succeed(
        SessionRunnerModel.resolved(model, {
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          cost: [],
          limit: { context: 200_000, output: 32_000 },
          cache: modelCache,
          compaction: nativeCompaction ? { type: "native" } : undefined,
        }),
      )

const compaction = Layer.mock(SessionCompaction.Service)({
  settings: () => ({ auto: autoEnabled, keep: 15_000, precompute: false, idleMinTokens: 50_000 }),
  transform: () => Effect.die("unused"),
  reload: () => Effect.void,
  compact: () => Effect.die("idle admission must not compact"),
  precompute: () => Effect.die("unused"),
})
const context = Layer.mock(SessionContext.Service)({
  select: () => Effect.die("unused"),
  load: () => Effect.die("unused"),
  resolveModel: () => resolveFixture(),
  selectTitle: () => Effect.die("unused"),
  request: {
    primary: () => Effect.die("unused"),
    compaction: () => Effect.die("unused"),
    generate: () => Effect.die("unused"),
    title: () => Effect.die("unused"),
  },
})
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      // The scheduler only resolves the model and reads compaction settings from a Location.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      Layer.mergeAll(compaction, context) as unknown as Layer.Layer<
        LocationServices,
        FileSystem.DirectoryNotFoundError
      >,
  ),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      App.node,
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionInbox.node,
      Session.node,
      SessionPresence.node,
      SessionIdleCompaction.node,
    ]),
    [
      LocationServiceMap.node.replace(locations),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      App.node.replace(App.configured({ channel: "local" })),
      Bus.node.replace(Bus.configured({ persist: true })),
    ],
  ),
)

const insertSession = (id: Session.ID, overrides?: Partial<typeof SessionTable.$inferInsert>) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: id,
        version: "test",
        model: { id: "summary-model", providerID: "test" },
        time_idle: 1,
        ...overrides,
      })
      .run()
      .pipe(Effect.orDie)
  })

const textUser = (text: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  })

const measured = (input: number, created = 0) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.defaultID,
    model: { id: "summary-model", providerID: "test" },
    content: [{ type: "text", text: "answer" }],
    tokens: { input, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, completed: created + 1 },
  })

const storeMessages = (sessionID: Session.ID, messages: readonly SessionMessage.Info[]) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(SessionMessageTable)
      .values(
        messages.map((message, index) => {
          const { id, type, ...data } = Schema.encodeSync(SessionMessage.Info)(message)
          return { id: SessionMessage.ID.make(id), session_id: sessionID, type, seq: index + 1, time_created: 0, data }
        }),
      )
      .run()
      .pipe(Effect.orDie)
    yield* Bus.reserveSequence(db, sessionID, messages.length)
  })

/** A present, idle Session with a warm 80k-token anchor at clock zero. */
const fixture = Effect.fnUntraced(function* (overrides?: Partial<typeof SessionTable.$inferInsert>) {
  const id = Session.ID.create()
  yield* insertSession(id, overrides)
  yield* storeMessages(id, [textUser("question"), measured(80_000)])
  const presence = yield* SessionPresence.Service
  yield* presence.report({ client: "a", sessions: [id] })
  return id
})

const idle = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const scheduler = yield* SessionIdleCompaction.Service
    yield* scheduler.touch(sessionID)
  })

const inbox = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    return yield* session.inbox(sessionID)
  })

describe("SessionIdleCompaction", () => {
  it.effect("fires at anchor + TTL - fire margin and admits an idle queue item", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      yield* idle(id)

      yield* TestClock.adjust("60 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])

      yield* TestClock.adjust("150 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([
        expect.objectContaining({
          type: "compaction",
          delivery: "queue",
          payload: expect.objectContaining({ reason: "idle" }),
        }),
      ])
    }),
  )

  it.effect("absent presence never fires", () =>
    Effect.gen(function* () {
      const id = Session.ID.create()
      yield* insertSession(id)
      yield* storeMessages(id, [textUser("question"), measured(80_000)])
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("flag off arms nothing", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }).pipe(Effect.provideService(Flag.Overrides, "-idle_compaction")),
  )

  it.effect("a terminal execution event arms the timer", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id })

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toHaveLength(1)
    }),
  )

  it.effect("shutdown interruption does not arm", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: id, reason: "shutdown" })

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("new execution cancels the timer", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      yield* idle(id)
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Execution.Started, { sessionID: id })

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("session deletion cancels the timer", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      yield* idle(id)
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Deleted, { sessionID: id })

      yield* TestClock.adjust("300 seconds")
      yield* drain
      const items = yield* SessionInbox.Service.pipe(Effect.flatMap((inbox) => inbox.list(id)))
      expect(items).toEqual([])
    }),
  )

  it.effect("a Session without a measured anchor arms nothing", () =>
    Effect.gen(function* () {
      const id = Session.ID.create()
      yield* insertSession(id)
      yield* storeMessages(id, [textUser("question")])
      const presence = yield* SessionPresence.Service
      yield* presence.report({ client: "a", sessions: [id] })
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("a cold anchor skips at fire", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      yield* TestClock.adjust("10 minutes")
      yield* idle(id)

      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("below the token floor skips", () =>
    Effect.gen(function* () {
      const id = Session.ID.create()
      yield* insertSession(id)
      yield* storeMessages(id, [textUser("question"), measured(10_000)])
      const presence = yield* SessionPresence.Service
      yield* presence.report({ client: "a", sessions: [id] })
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("subagent sessions skip", () =>
    Effect.gen(function* () {
      const id = yield* fixture({ parent_id: Session.ID.make("ses_parent") })
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("archived sessions skip", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      const session = yield* Session.Service
      yield* session.archive(id)
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("a staged revert skips", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: id,
        revert: { messageID: SessionMessage.ID.create(), files: [] },
      })
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
    }),
  )

  it.effect("automatic compaction off skips before admission", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      autoEnabled = false
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
      const db = (yield* Database.Service).db
      const enqueued = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, id))
        .pipe(Effect.map((rows) => rows.filter((row) => row.type === "session.inbox.enqueued")))
      expect(enqueued).toEqual([])
      autoEnabled = true
    }),
  )

  it.effect("a one-hour TTL fires inside the lease window", () =>
    Effect.gen(function* () {
      modelCache = { ttl: "1h" }
      const id = yield* fixture()
      yield* idle(id)

      yield* TestClock.adjust("3500 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])

      yield* TestClock.adjust("20 seconds")
      yield* drain
      expect(yield* inbox(id)).toHaveLength(1)
      modelCache = { ttl: "5m" }
    }),
  )

  it.effect("a model without explicit cache.ttl skips", () =>
    Effect.gen(function* () {
      modelCache = undefined
      const id = yield* fixture()
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
      modelCache = { ttl: "5m" }
    }),
  )

  it.effect("a native-compaction model skips", () =>
    Effect.gen(function* () {
      nativeCompaction = true
      const id = yield* fixture()
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
      nativeCompaction = false
    }),
  )

  it.effect("an unresolvable model arms nothing", () =>
    Effect.gen(function* () {
      resolveError = true
      const id = yield* fixture()
      yield* idle(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toEqual([])
      resolveError = false
    }),
  )

  it.effect("touch re-arms from durable state after cancel", () =>
    Effect.gen(function* () {
      const id = yield* fixture()
      const scheduler = yield* SessionIdleCompaction.Service
      yield* scheduler.touch(id)
      yield* scheduler.cancel(id)
      yield* scheduler.touch(id)

      yield* TestClock.adjust("300 seconds")
      yield* drain
      expect(yield* inbox(id)).toHaveLength(1)
    }),
  )
})
