import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { AISDK } from "@opencode/core/aisdk"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Money } from "@opencode/schema/money"
import { Npm } from "@opencode/util/npm"
import { DateTime, Effect, Layer } from "effect"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const ref = location({ directory: AbsolutePath.make("test") })
const primaryProvider = Provider.ID.make("primary")
const otherProvider = Provider.ID.make("other")

const modelInfo = (providerID: Provider.ID, id: string, cost: Model.Info["cost"]) =>
  Model.Info.make({
    ...Model.Info.default(providerID, Model.ID.make(id)),
    package: "@opencode/ai/providers/deepseek",
    settings: { baseURL: `https://${providerID}.example/v1` },
    cost,
  })

const primary = modelInfo(primaryProvider, "executor", [])
const other = modelInfo(otherProvider, "other-model", [
  {
    input: Money.USDPerMillionTokens.make(3),
    output: Money.USDPerMillionTokens.make(4),
    cache: { read: Money.USDPerMillionTokens.make(1), write: Money.USDPerMillionTokens.make(2) },
  },
])

const provider = Provider.Info.make({
  ...Provider.Info.empty(otherProvider),
  activation: "enabled",
  package: "@opencode/ai/providers/deepseek",
  settings: { baseURL: "https://other.example/v1" },
})

const resolver = ModelResolver.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(Provider.Service, { get: () => Effect.succeed(provider) }),
      Layer.mock(Model.Service, {}),
      Layer.mock(Integration.Service, {
        revision: () => 0,
        connection: {
          active: () => Effect.succeed(undefined),
          resolve: () => Effect.die("unused"),
          key: () => Effect.die("unused"),
          external: () => Effect.die("unused"),
          activate: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
          remove: () => Effect.die("unused"),
          status: () => Effect.die("unused"),
        },
        oauth: {
          connect: () => Effect.die("unused"),
          status: () => Effect.die("unused"),
          complete: () => Effect.die("unused"),
          cancel: () => Effect.die("unused"),
        },
        command: {
          connect: () => Effect.die("unused"),
          status: () => Effect.die("unused"),
          cancel: () => Effect.die("unused"),
        },
      }),
      Layer.mock(Npm.Service, {
        add: () => Effect.die("unused"),
        which: () => Effect.die("unused"),
      }),
      Layer.mock(AISDK.Service, {
        hook: {
          sdk: () => Effect.die("unused"),
          language: () => Effect.die("unused"),
        },
        model: () => Effect.die("unused"),
      }),
    ),
  ),
)

const layer = AppNodeBuilder.build(
  LayerNode.group([ModelResolver.node, Agent.node, PluginHooks.node, SessionRunnerModel.node]),
  [
    ModelResolver.node.replace(resolver),
    Agent.node.replace(Layer.mock(Agent.Service)({})),
    Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(ref))),
  ],
)

const it = testEffect(layer)

it.effect(
  "resolves a generate override from another provider through the real resolver",
  () =>
    Effect.gen(function* () {
      const runner = yield* SessionRunnerModel.Service
      const session = Session.Info.make({
        id: Session.ID.make("ses_runner_model"),
        projectID: Project.ID.global,
        model: { providerID: other.providerID, id: other.id },
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: ref,
      })

      const resolved = yield* runner.resolve(session, () => Effect.succeed([primary, other]), {
        kind: "generate",
        agent: Agent.ID.make("build"),
      })

      expect(resolved.ref).toEqual({ providerID: other.providerID, id: other.id })
      expect(resolved.cost).toEqual(other.cost)
    }),
)
