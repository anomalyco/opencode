import { describe, expect } from "bun:test"
import { LanguageModel } from "@opencode/ai/effect"
import { AnthropicMessages } from "@opencode/ai/protocols"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { DateTime, Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const info = Model.Info.make(Model.Info.default(Provider.ID.make("test"), Model.ID.make("claude-opus-5-5")))
const session = Session.Info.make({
  id: Session.ID.make("ses_runner_model"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
  model: Model.Ref.make({ providerID: info.providerID, id: info.id }),
})
const resolved = SessionRunnerModel.resolved(
  LanguageModel.make({
    id: info.id,
    provider: info.providerID,
    route: AnthropicMessages.route,
    capabilities: { tools: { updates: ["add", "remove", "replace"] } },
  }),
  { capabilities: info.capabilities, cost: [], limit: { context: 200_000, output: 32_000 } },
)

const runnerModel = (overrides: string | undefined) =>
  testEffect(
    AppNodeBuilder.build(SessionRunnerModel.node, [
      ModelResolver.node.replace(Layer.mock(ModelResolver.Service)({ resolveModel: () => Effect.succeed(resolved) })),
      Agent.node.replace(Layer.mock(Agent.Service)({})),
      Flag.node.replace(Flag.testLayer([], { app: { channel: "local" }, overrides })),
    ]),
  )

const updates = Effect.gen(function* () {
  const models = yield* SessionRunnerModel.Service
  const model = yield* models.resolve(session, () => Effect.succeed([info]), {
    kind: "primary",
    agent: Agent.ID.make("build"),
  })
  return model.model.capabilities?.tools?.updates
})

describe("SessionRunnerModel tool_updates flag", () => {
  runnerModel(undefined).effect("keeps the model's tool updates when the flag is on", () =>
    Effect.gen(function* () {
      expect(yield* updates).toEqual(["add", "remove", "replace"])
    }),
  )

  runnerModel("-tool_updates").effect("drops the model's tool updates when the flag is off", () =>
    Effect.gen(function* () {
      expect(yield* updates).toEqual([])
    }),
  )
})
