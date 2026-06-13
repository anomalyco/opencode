import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ModelsDevPlugin } from "@opencode-ai/core/plugin/models-dev"
import { Policy } from "@opencode-ai/core/policy"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const events = EventV2.defaultLayer
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const plugins = PluginV2.layer.pipe(Layer.provide(events))
const policy = Policy.layer.pipe(Layer.provide(locationLayer))
const connections = Credential.layer.pipe(
  Layer.fresh,
  Layer.provide(Database.layerFromPath(":memory:").pipe(Layer.fresh)),
  Layer.provide(events),
)
const catalog = Catalog.layer.pipe(Layer.provide(Layer.mergeAll(events, locationLayer, plugins, policy, connections)))
const integrations = Integration.locationLayer.pipe(Layer.provide(events), Layer.provide(connections))
const layer = Layer.mergeAll(
  catalog.pipe(Layer.provide(connections)),
  integrations,
  connections,
  events,
  locationLayer,
  plugins,
)
const it = testEffect(layer)

function withModelsDevFixture<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = {
        path: Flag.OPENCODE_MODELS_PATH,
        disabled: Flag.OPENCODE_DISABLE_MODELS_FETCH,
      }
      Flag.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "fixtures", "models-dev.json")
      Flag.OPENCODE_DISABLE_MODELS_FETCH = true
      return previous
    }),
    () => effect.pipe(Effect.provide(ModelsDev.defaultLayer)),
    (previous) =>
      Effect.sync(() => {
        Flag.OPENCODE_MODELS_PATH = previous.path
        Flag.OPENCODE_DISABLE_MODELS_FETCH = previous.disabled
      }),
  )
}

describe("ModelsDevPlugin", () => {
  it.effect("registers key methods for providers with environment variables", () =>
    withModelsDevFixture(
      Effect.gen(function* () {
        yield* ModelsDevPlugin.effect
        const integrations = yield* Integration.Service
        expect(yield* integrations.list()).toEqual([
          new Integration.Info({
            id: Integration.ID.make("acme"),
            name: "Acme",
            methods: [
              new Integration.KeyMethod({ type: "key" }),
              new Integration.EnvMethod({
                type: "env",
                names: ["ACME_API_KEY"],
              }),
            ],
            connections: [],
          }),
        ])
      }),
    ),
  )

  it.effect("synthesizes effort reasoning option variants", () =>
    withModelsDevFixture(
      Effect.gen(function* () {
        yield* ModelsDevPlugin.effect
        const catalog = yield* Catalog.Service
        const model = yield* catalog.model.get(ProviderV2.ID.make("zai-coding-plan"), ModelV2.ID.make("glm-5.2"))
        expect(model.variants).toEqual([
          {
            id: ModelV2.VariantID.make("high"),
            headers: {},
            generation: {},
            options: { reasoningEffort: "high" },
            body: {},
          },
          {
            id: ModelV2.VariantID.make("max"),
            headers: {},
            generation: {},
            options: { reasoningEffort: "max" },
            body: {},
          },
        ])
      }),
    ),
  )

  it.effect("keeps experimental modes higher priority than reasoning options", () =>
    withModelsDevFixture(
      Effect.gen(function* () {
        yield* ModelsDevPlugin.effect
        const catalog = yield* Catalog.Service
        const model = yield* catalog.model.get(ProviderV2.ID.make("zai-coding-plan"), ModelV2.ID.make("mode-priority"))
        expect(model.variants).toEqual([
          {
            id: ModelV2.VariantID.make("custom"),
            headers: { "x-model-mode": "custom" },
            generation: {},
            options: { reasoningEffort: "high" },
            body: {},
          },
        ])
      }),
    ),
  )
})
