import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevPlugin } from "@opencode-ai/core/plugin/models-dev"
import { Policy } from "@opencode-ai/core/policy"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host, integrationHost } from "./host"

const events = EventV2.defaultLayer
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const policy = Policy.layer.pipe(Layer.provide(locationLayer))
const connections = Credential.defaultLayer.pipe(Layer.fresh)
const integrations = Integration.locationLayer.pipe(Layer.provide(events), Layer.provide(connections))
const catalog = Catalog.layer.pipe(
  Layer.provide(Layer.mergeAll(events, locationLayer, policy, connections, integrations)),
)
const layer = Layer.mergeAll(catalog.pipe(Layer.provide(connections)), integrations, connections, events, locationLayer)
const it = testEffect(layer)

const withFixture = <A, E, R>(use: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = {
        path: Flag.OPENCODE_MODELS_PATH,
        disabled: Flag.OPENCODE_DISABLE_MODELS_FETCH,
      }
      Flag.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "fixtures", "models-dev.json")
      Flag.OPENCODE_DISABLE_MODELS_FETCH = true
      return previous
    }),
    () => use.pipe(Effect.provide(ModelsDev.defaultLayer)),
    (previous) =>
      Effect.sync(() => {
        Flag.OPENCODE_MODELS_PATH = previous.path
        Flag.OPENCODE_DISABLE_MODELS_FETCH = previous.disabled
      }),
  )

describe("ModelsDevPlugin", () => {
  it.effect("registers key methods for providers with environment variables", () =>
    withFixture(
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const catalog = yield* Catalog.Service
        yield* ModelsDevPlugin.effect(
          host({
            catalog: catalogHost(catalog),
            integration: integrationHost(integrations),
          }),
        )
        expect(yield* integrations.list()).toEqual([
          new Integration.Info({
            id: Integration.ID.make("acme"),
            name: "Acme",
            methods: [
              { type: "key" },
              {
                type: "env",
                names: ["ACME_API_KEY"],
              },
            ],
            connections: [],
          }),
          new Integration.Info({
            id: Integration.ID.make("mammouth-ai"),
            name: "Mammouth AI",
            methods: [
              { type: "key" },
              {
                type: "env",
                names: ["MAMMOUTH_API_KEY"],
              },
            ],
            connections: [],
          }),
        ])
      }),
    ),
  )

  it.effect("maps explicit model efforts to reasoning_effort variants", () =>
    withFixture(
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const catalog = yield* Catalog.Service
        yield* ModelsDevPlugin.effect(
          host({
            catalog: catalogHost(catalog),
            integration: integrationHost(integrations),
          }),
        )
        const model = yield* catalog.model.get(ProviderV2.ID.make("acme"), ModelV2.ID.make("deluxe"))
        expect(model?.variants).toEqual([
          expect.objectContaining({ id: "low", body: { reasoning_effort: "low" } }),
          expect.objectContaining({ id: "medium", body: { reasoning_effort: "medium" } }),
          expect.objectContaining({ id: "high", body: { reasoning_effort: "high" } }),
          expect.objectContaining({ id: "xhigh", body: { reasoning_effort: "xhigh" } }),
          expect.objectContaining({ id: "max", body: { reasoning_effort: "max" } }),
        ])
      }),
    ),
  )
})
