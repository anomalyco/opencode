import { expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Money } from "@opencode/schema/money"
import { withEnv } from "./fixture/env"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

const ref = location({ directory: AbsolutePath.make("test") })
const layer = AppNodeBuilder.build(
  LayerNode.group([Provider.node, Model.node, ModelResolver.node, SessionRunnerModel.node]),
  [Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(ref)))],
)
const free = Model.ID.make("big-pickle")
const paid = Model.ID.make("paid")
const local = Model.ID.make("local")
const other = Provider.ID.make("other")

for (const flag of [undefined, "0", "1", "true"]) {
  for (const providerID of [Provider.ID.opencode, Provider.ID.make("opencode-go")])
    it.effect(`${providerID} catalog with OPENCODE_DISABLE_FREE_MODELS=${flag}`, () =>
      withEnv({ OPENCODE_DISABLE_FREE_MODELS: flag }, () =>
        Effect.gen(function* () {
          const providers = yield* Provider.Service
          const models = yield* Model.Service
          const runner = yield* SessionRunnerModel.Service
          const resolver = yield* ModelResolver.Service
          yield* providers.transform((editor) => {
            editor.update(providerID, () => {})
            editor.models.update(providerID, free, (model) => {
              model.time.released = 3000
              model.family = Model.Family.make("gpt-luna")
              model.capabilities = { ...model.capabilities, input: ["text"], output: ["text"] }
            })
            editor.models.update(providerID, paid, (model) => {
              model.time.released = 2000
              model.cost = [
                {
                  input: Money.USDPerMillionTokens.make(1),
                  output: Money.USDPerMillionTokens.zero,
                  cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
                },
              ]
            })
            editor.update(other, () => {})
            editor.models.update(other, local, () => {})
          })
          yield* models.transform((editor) => editor.default.set(providerID, free))
          const disabled = flag === "1" || flag === "true"
          expect((yield* models.all()).map((model) => model.id)).toEqual(disabled ? [paid, local] : [free, paid, local])
          expect(yield* models.available()).toEqual(yield* models.all())
          expect((yield* models.default())?.id).toBe(disabled ? paid : free)
          expect((yield* models.get(providerID, free))?.id).toBe(disabled ? undefined : free)
          expect((yield* models.small(providerID))?.id).toBe(disabled ? undefined : free)
          if (!disabled) return
          const session = Session.Info.make({
            id: Session.ID.make("ses_free_model"),
            projectID: Project.ID.global,
            title: "test",
            model: { id: free, providerID },
            cost: Money.USD.zero,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
            location: ref,
          })
          const failure = yield* runner.resolve(session, models.available).pipe(Effect.flip)
          expect(failure.message).toBe(`Model unavailable: ${providerID}/big-pickle`)
          expect(yield* resolver.resolve(Model.Ref.make({ providerID, id: free }))).toBeUndefined()
          // Later transforms cannot restore a free model, even when all paid models are removed.
          yield* models.transform((editor) => {
            editor.update(providerID, free, (model) => {
              model.enabled = true
            })
            editor.remove(providerID, paid)
          })
          expect((yield* models.default())?.providerID).toBe(other)
          expect(yield* models.get(providerID, free)).toBeUndefined()
        }).pipe(Effect.provide(layer)),
      ),
    )
}
