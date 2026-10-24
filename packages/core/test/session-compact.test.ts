import type { FileSystem } from "@opencode/core/filesystem"
import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, LanguageModel, type LLMRequest } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionCompaction } from "@opencode/core/session/compaction"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStore } from "@opencode/core/session/store"
import { Effect, Layer, LayerMap, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = LanguageModel.make({
  id: "summary-model",
  provider: "test",
  route: OpenAIChat.route,
})
let requests: LLMRequest[] = []
const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    return Stream.make(LLMEvent.textDelta({ id: "summary", text: "manual session summary" }))
  },
  generate: () => Effect.die("unused"),
})
const config = Layer.mock(Config.Service)({ entries: () => Effect.succeed([]) })
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () =>
    Effect.succeed(
      SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [],
        limit: { context: 10_000, output: 1_000 },
      }),
    ),
})
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      // The test only needs the compaction location service used by Session.compact.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      SessionCompaction.layer.pipe(
        Layer.provide(client),
        Layer.provide(config),
        Layer.provide(models),
      ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
  ),
)
const wakeups: Session.ID[] = []
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const base = yield* SessionExecution.Service
    return {
      ...base,
      wake: (sessionID: Session.ID) =>
        Effect.sync(() => {
          wakeups.push(sessionID)
        }),
    }
  }),
).pipe(Layer.provide(SessionExecution.noopLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      LocationServiceMap.node.replace(locations),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(execution),
    ],
  ),
)

describe("Session.compact", () => {
  it.effect("durably coalesces manual compaction", () =>
    Effect.gen(function* () {
      requests = []
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })

      const messageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: created.id,
        inboxID: messageID,
        item: {
          type: "user",
          payload: { text: "Please compact this session history." },
          delivery: "steer",
        },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, {
        sessionID: created.id,
        inboxID: messageID,
      })

      expect(yield* session.compact({ id: messageID, sessionID: created.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.CompactionConflictError",
        inputID: messageID,
      })
      const first = yield* session.compact({ sessionID: created.id })
      const second = yield* session.compact({ sessionID: created.id })

      expect(second.id).toBe(first.id)
      expect(requests).toHaveLength(0)
      expect(yield* session.inbox(created.id)).toEqual([
        expect.objectContaining({ id: first.id, type: "compaction", delivery: "steer" }),
      ])
      expect((yield* session.context(created.id)).find((message) => message.id === first.id)).toBeUndefined()

      const queued = yield* session.create({ location })
      const queue = yield* session.compact({ sessionID: queued.id, delivery: "queue" })
      expect(queue).toMatchObject({ type: "compaction", delivery: "queue" })
    }),
  )

  it.effect("coalesces concurrent manual compaction", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      const admitted = yield* Effect.all(
        [SessionMessage.ID.create(), SessionMessage.ID.create()].map((id) =>
          session.compact({ id, sessionID: created.id }),
        ),
        { concurrency: "unbounded" },
      )

      expect(admitted[1]?.id).toBe(admitted[0]?.id)
      expect(yield* session.inbox(created.id)).toHaveLength(1)
    }),
  )

  for (const position of ["before", "at"] as const) {
    it.effect(`preserves a staged revert when the conflicting ID is ${position} its boundary`, () =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const bus = yield* Bus.Service
        const created = yield* session.create({ location })
        const ids = [SessionMessage.ID.create(), SessionMessage.ID.create(), SessionMessage.ID.create()] as const
        for (const id of ids) {
          yield* bus.publish(SessionEvent.InboxEnqueued, {
            sessionID: created.id,
            inboxID: id,
            item: { type: "user", payload: { text: "Keep this message available for redo." }, delivery: "steer" },
          })
          yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: created.id, inboxID: id })
        }
        const boundary = ids[1]
        yield* bus.publish(SessionEvent.RevertEvent.Staged, {
          sessionID: created.id,
          revert: { messageID: boundary, files: [] },
        })
        const before = {
          messages: yield* session.messages({ sessionID: created.id }),
          revert: (yield* session.get(created.id)).revert,
        }
        const id = position === "before" ? ids[0] : boundary

        expect(yield* session.compact({ sessionID: created.id, id }).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.CompactionConflictError",
          inputID: id,
        })
        expect({
          messages: yield* session.messages({ sessionID: created.id }),
          revert: (yield* session.get(created.id)).revert,
        }).toEqual(before)
        expect(yield* session.inbox(created.id)).toEqual([])
        expect(wakeups.filter((id) => id === created.id)).toEqual([])
      }),
    )
  }

  it.effect("replaces a pending compaction removed by committing a staged revert", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const boundary = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: created.id,
        inboxID: boundary,
        item: { type: "user", payload: { text: "Undo this prompt." }, delivery: "steer" },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: created.id, inboxID: boundary })
      const removed = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: created.id,
        inboxID: removed,
        item: { type: "compaction", payload: {}, delivery: "steer" },
      })
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: created.id,
        revert: { messageID: boundary, files: [] },
      })
      const id = SessionMessage.ID.create()

      expect(yield* session.compact({ sessionID: created.id, id })).toMatchObject({ id, type: "compaction" })
      expect((yield* session.get(created.id)).revert).toBeUndefined()
      expect(yield* session.inbox(created.id)).toEqual([expect.objectContaining({ id, type: "compaction" })])
      expect(wakeups.filter((id) => id === created.id)).toEqual([created.id])
    }),
  )

  it.effect("does not commit a staged revert when retrying an admitted compaction", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const first = yield* session.compact({ sessionID: created.id, delivery: "queue" })
      const boundary = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: created.id,
        inboxID: boundary,
        item: { type: "user", payload: { text: "Keep this prompt available for redo." }, delivery: "steer" },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: created.id, inboxID: boundary })
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: created.id,
        revert: { messageID: boundary, files: [] },
      })
      const before = {
        messages: yield* session.messages({ sessionID: created.id }),
        revert: (yield* session.get(created.id)).revert,
      }
      const beforeWakeups = wakeups.filter((id) => id === created.id)

      expect(yield* session.compact({ sessionID: created.id, id: first.id })).toEqual(first)
      expect(wakeups.filter((id) => id === created.id)).toEqual(beforeWakeups)
      expect({
        messages: yield* session.messages({ sessionID: created.id }),
        revert: (yield* session.get(created.id)).revert,
      }).toEqual(before)
      expect(yield* session.inbox(created.id)).toEqual([first])
    }),
  )

  it.effect("commits a staged revert before admitting manual compaction", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()

      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: created.id,
        inboxID: messageID,
        item: {
          type: "user",
          payload: { text: "Undo this prompt before compacting." },
          delivery: "steer",
        },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, {
        sessionID: created.id,
        inboxID: messageID,
      })
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: created.id,
        revert: { messageID, files: [] },
      })

      expect((yield* session.get(created.id)).revert?.messageID).toBe(messageID)

      const compacted = yield* session.compact({ sessionID: created.id })

      expect((yield* session.get(created.id)).revert).toBeUndefined()
      expect(yield* session.context(created.id)).toEqual([])
      expect(yield* session.inbox(created.id)).toEqual([
        expect.objectContaining({ id: compacted.id, type: "compaction" }),
      ])
    }),
  )
})
