import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Job } from "@opencode-ai/core/job"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionPending } from "@opencode-ai/core/session/pending"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { DateTime, Effect, Layer, LayerMap, Stream } from "effect"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = Model.make({
  id: "summary-model",
  provider: "test",
  route: OpenAIChat.route.with({ limits: { context: 10_000, output: 1_000 } }),
})
const projects = Layer.succeed(
  Project.Service,
  Project.Service.of({
    list: () => Effect.succeed([]),
    resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
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
      ) as unknown as Layer.Layer<LocationServices>,
  ),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [LocationServiceMap.node, locations],
      [Project.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

describe("Session.compact", () => {
  it.effect("durably admits and coalesces manual compaction", () =>
    Effect.gen(function* () {
      requests = []
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })

      const messageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InputAdmitted, {
        sessionID: created.id,
        inputID: messageID,
        input: {
          type: "user",
          data: { text: "Please compact this session history." },
          delivery: "steer",
        },
      })
      yield* bus.publish(SessionEvent.InputPromoted, {
        sessionID: created.id,
        inputID: messageID,
      })

      expect(yield* session.compact({ id: messageID, sessionID: created.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.CompactionConflictError",
        inputID: messageID,
      })
      const first = yield* session.compact({ sessionID: created.id })
      const second = yield* session.compact({ sessionID: created.id })

      expect(second.id).toBe(first.id)
      expect(requests).toHaveLength(0)
      expect(yield* SessionPending.compaction((yield* Database.Service).db, created.id)).toMatchObject({
        id: first.id,
      })
      expect((yield* session.context(created.id)).find((message) => message.id === first.id)).toBeUndefined()
    }),
  )
})
