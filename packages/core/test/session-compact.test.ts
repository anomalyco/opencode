import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
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
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
let requests: LLMRequest[] = []
const client = Layer.mock(LLMClient.Service)({
  prepare: () => Effect.die("unused"),
  stream: (request: LLMRequest) => {
    requests.push(request)
    return Stream.make(LLMEvent.textDelta({ id: "summary", text: "manual session summary" }))
  },
  generate: () => Effect.die("unused"),
})
const config = Layer.mock(Config.Service)({ entries: () => Effect.succeed([]) })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      // The test only needs the compaction location service used by SessionV2.compact.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      SessionCompaction.layer.pipe(
        Layer.provide(client),
        Layer.provide(config),
        Layer.provide(models),
      ) as unknown as Layer.Layer<LocationServices>,
  ),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(locations),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(projects),
  Layer.provide(SessionExecution.noopLayer),
)
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    projects,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionExecution.noopLayer,
    sessions,
  ),
)

describe("SessionV2.compact", () => {
  it.effect("manually compacts the active session context", () =>
    Effect.gen(function* () {
      requests = []
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })

      yield* events.publish(SessionEvent.Prompted, {
        sessionID: created.id,
        messageID: SessionMessage.ID.create(),
        timestamp: DateTime.makeUnsafe(0),
        prompt: Prompt.make({ text: "Please compact this session history." }),
        delivery: "steer",
      })

      yield* session.compact({ sessionID: created.id })

      expect(requests).toHaveLength(1)
      expect(JSON.stringify(requests[0]?.messages)).toContain("Please compact this session history.")
      expect(yield* session.context(created.id)).toMatchObject([
        { type: "compaction", reason: "manual", summary: "manual session summary", recent: "" },
      ])
    }),
  )
})
