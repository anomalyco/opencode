import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Money } from "@opencode-ai/schema/money"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const active = new Set<Session.ID>()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(
        Layer.succeed(
          SessionExecution.Service,
          SessionExecution.Service.of({
            active: Effect.sync(() => active),
            isActive: (sessionID) => Effect.sync(() => active.has(sessionID)),
            resume: () => Effect.void,
            wake: () => Effect.void,
            interrupt: () => Effect.succeed(false),
            awaitIdle: () => Effect.void,
          }),
        ),
      ),
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const start = (bus: Bus.Interface, sessionID: Session.ID, messageID: SessionMessage.ID) =>
  bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID: messageID,
    agent: Agent.defaultID,
    model,
  })

const complete = (bus: Bus.Interface, sessionID: Session.ID, messageID: SessionMessage.ID) =>
  bus.publish(SessionEvent.Step.Ended, {
    sessionID,
    assistantMessageID: messageID,
    finish: "stop",
    cost: Money.USD.make(0),
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })

describe("Session.updateMessage", () => {
  it.effect("replaces assistant content through a durable projected event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const created = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      yield* start(bus, created.id, messageID)
      yield* complete(bus, created.id, messageID)

      const content = [
        SessionMessage.AssistantText.make({ type: "text", text: "replacement" }),
        SessionMessage.AssistantReasoning.make({
          type: "reasoning",
          text: "updated reasoning",
          time: { created: created.time.created },
        }),
      ]
      const updated = yield* session.updateMessage({ sessionID: created.id, messageID, content })

      expect(updated.content).toEqual(content)
      expect(yield* session.message({ sessionID: created.id, messageID })).toMatchObject({ content })
      expect((yield* session.messages({ sessionID: created.id }))[0]).toMatchObject({ id: messageID, content })

      const events = Array.from(yield* Stream.runCollect(session.log({ sessionID: created.id })))
      expect(events.at(-2)).toMatchObject({
        type: "session.message.content.updated",
        data: {
          sessionID: created.id,
          messageID,
          content: [
            { type: "text", text: "replacement" },
            { type: "reasoning", text: "updated reasoning", time: { created: expect.any(Number) } },
          ],
        },
      })
      expect(
        yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.type, Bus.versionedType(SessionEvent.MessageContentUpdated.type, 1)))
          .get(),
      ).toMatchObject({ aggregate_id: created.id, data: { messageID } })

      expect((yield* session.updateMessage({ sessionID: created.id, messageID, content: [] })).content).toEqual([])
    }),
  )

  it.effect("replays updated assistant content into a fresh projection", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const created = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      yield* start(bus, created.id, messageID)
      yield* complete(bus, created.id, messageID)
      const content = [
        SessionMessage.AssistantReasoning.make({
          type: "reasoning",
          text: "replayed reasoning",
          time: { created: created.time.created },
        }),
      ]
      yield* session.updateMessage({ sessionID: created.id, messageID, content })

      const serialized = (yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        created: event.created,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))
      const tmp = yield* tmpdirScoped()
      const target = AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]),
        [
          Database.node.replace(Database.configured({ path: path.join(tmp.path, "target.sqlite") })),
          Bus.node.replace(Bus.configured({ persist: true })),
        ],
      )

      yield* Effect.gen(function* () {
        const database = (yield* Database.Service).db
        const replay = yield* Bus.Service
        const store = yield* SessionStore.Service
        yield* database
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)
        yield* Effect.forEach(serialized, (event) => replay.replay(event), { discard: true })
        expect((yield* store.message(messageID))?.message).toMatchObject({ content })
      }).pipe(Effect.provide(Layer.fresh(target)))
    }),
  )

  it.effect("rejects missing and cross-session messages", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const other = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      yield* start(bus, created.id, messageID)
      yield* complete(bus, created.id, messageID)

      expect(yield* Effect.flip(session.updateMessage({ sessionID: other.id, messageID, content: [] }))).toEqual(
        new Session.MessageNotFoundError({ sessionID: other.id, messageID }),
      )
      const missing = Session.ID.create()
      expect(yield* Effect.flip(session.updateMessage({ sessionID: missing, messageID, content: [] }))).toEqual(
        new Session.NotFoundError({ sessionID: missing }),
      )
    }),
  )

  it.effect("rejects non-assistant messages, incomplete assistants, and unfinished tools", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const synthetic = yield* bus.publish(SessionEvent.Synthetic, { sessionID: created.id, text: "synthetic" })
      const syntheticID = SessionMessage.ID.fromEvent(synthetic.id)

      expect(
        yield* Effect.flip(session.updateMessage({ sessionID: created.id, messageID: syntheticID, content: [] })),
      ).toEqual(new Session.MessageNotAssistantError({ sessionID: created.id, messageID: syntheticID }))

      const messageID = SessionMessage.ID.create()
      yield* start(bus, created.id, messageID)
      expect(yield* Effect.flip(session.updateMessage({ sessionID: created.id, messageID, content: [] }))).toEqual(
        new Session.MessageIncompleteError({ sessionID: created.id, messageID }),
      )

      yield* complete(bus, created.id, messageID)
      yield* Effect.forEach(
        [
          SessionMessage.ToolStateStreaming.make({ status: "streaming", input: "" }),
          SessionMessage.ToolStateRunning.make({ status: "running", input: {}, metadata: {} }),
        ],
        Effect.fnUntraced(function* (state) {
          const unfinished = SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call_unfinished",
            name: "read",
            state,
            time: { created: created.time.created },
          })
          expect(
            yield* Effect.flip(session.updateMessage({ sessionID: created.id, messageID, content: [unfinished] })),
          ).toEqual(new Session.MessageToolIncompleteError({ sessionID: created.id, messageID }))
        }),
      )
    }),
  )

  it.effect("accepts completed and failed tool content", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      yield* start(bus, created.id, messageID)
      yield* complete(bus, created.id, messageID)
      const content = [
        SessionMessage.ToolStateCompleted.make({
          status: "completed",
          input: {},
          content: [{ type: "text", text: "result" }],
        }),
        SessionMessage.ToolStateError.make({ status: "error", input: {}, error: { type: "tool", message: "failed" } }),
      ].map((state) =>
        SessionMessage.AssistantTool.make({
          type: "tool",
          id: `call_${state.status}`,
          name: "read",
          state,
          time: { created: created.time.created },
        }),
      )

      expect((yield* session.updateMessage({ sessionID: created.id, messageID, content })).content).toEqual(content)
    }),
  )

  it.effect("rejects a completed assistant while its session is active", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()
      yield* start(bus, created.id, messageID)
      yield* complete(bus, created.id, messageID)
      active.add(created.id)
      const failure = yield* Effect.flip(session.updateMessage({ sessionID: created.id, messageID, content: [] }))
      active.delete(created.id)

      expect(failure).toEqual(new Session.BusyError({ sessionID: created.id }))
    }),
  )
})
