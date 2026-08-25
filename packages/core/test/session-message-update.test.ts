import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
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
import { testEffect } from "./lib/effect"
import { globalProjectLayer } from "./lib/project"

const active = new Set<Session.ID>()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [Project.node, globalProjectLayer],
      [
        SessionExecution.node,
        Layer.succeed(
          SessionExecution.Service,
          SessionExecution.Service.of({
            active: Effect.sync(() => active),
            resume: () => Effect.void,
            wake: () => Effect.void,
            interrupt: () => Effect.succeed(false),
            awaitIdle: () => Effect.void,
          }),
        ),
      ],
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

  it.effect("rejects non-assistant and incomplete assistant messages", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const synthetic = yield* bus.publish(SessionEvent.Synthetic, { sessionID: created.id, text: "synthetic" })
      const syntheticID = SessionMessage.ID.fromEvent(synthetic.id)

      expect(
        yield* Effect.flip(session.updateMessage({ sessionID: created.id, messageID: syntheticID, content: [] })),
      ).toEqual(
        new Session.MessageUpdateError({ sessionID: created.id, messageID: syntheticID, reason: "not_assistant" }),
      )

      const messageID = SessionMessage.ID.create()
      yield* start(bus, created.id, messageID)
      expect(yield* Effect.flip(session.updateMessage({ sessionID: created.id, messageID, content: [] }))).toEqual(
        new Session.MessageUpdateError({ sessionID: created.id, messageID, reason: "incomplete" }),
      )
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
