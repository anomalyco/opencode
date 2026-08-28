import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, LanguageModel, type LLMRequest } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { InstanceMap } from "@opencode-ai/core/instance-map"
import { stubLocations } from "./fixture/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Effect, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectLayer } from "./lib/project"

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
// The test only needs the compaction location service used by Session.compact.
const locations = stubLocations(
  SessionCompaction.layer.pipe(Layer.provide(client), Layer.provide(config), Layer.provide(models)),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [InstanceMap.node, locations],
      [Project.node, globalProjectLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
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
})
