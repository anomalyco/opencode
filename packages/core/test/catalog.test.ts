import { describe, expect } from "bun:test"
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Effect, Fiber, Layer, Ref, Stream } from "effect"
import { Integration } from "@opencode/core/integration"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)
const modelLayer = AppNodeBuilder.build(
  LayerNode.group([Provider.node, Model.node, Bus.node, Credential.node, Integration.node]),
  [Location.node.replace(locationLayer)],
)
const it = testEffect(modelLayer)

describe("Provider and Model", () => {
  ;["variant", "empty-key", "metadata", "aisdk"].forEach((path) =>
    it.effect(`keeps nested model values editable after ${path} model resolution`, () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const providerID = Provider.ID.make("resolve-fixture")
        const modelID = Model.ID.make("fixture-model")
        yield* providers.transform((editor) => editor.update(providerID, () => {}))
        yield* models.transform((editor) =>
          editor.update(providerID, modelID, (model) => {
            model.package = path === "aisdk" ? Provider.aisdk("@ai-sdk/fixture") : "@opencode/ai/providers/openai"
            model.settings = {
              apiKey: path === "empty-key" ? "" : "fixture-key",
              baseURL: "https://fixture.example/v1",
            }
            model.variants = [{ id: Model.VariantID.make("high"), body: { reasoning: { effort: "high" } } }]
          }),
        )
        const selected = required(yield* models.get(providerID, modelID))
        if (path === "variant") yield* ModelResolver.withVariant(selected, Model.VariantID.make("high"))
        if (path !== "variant")
          yield* ModelResolver.fromCatalogModel(
            selected,
            path === "metadata"
              ? Credential.Key.make({ type: "key", key: "fixture-key", metadata: { tenant: "fixture" } })
              : undefined,
            {
              loadAISDK: () =>
                Effect.succeed(LanguageModel.make({ id: modelID, provider: providerID, route: OpenAIChat.route })),
            },
          )

        yield* models.transform((editor) =>
          editor.update(providerID, modelID, (model) => {
            model.limit.context = 100_000
            model.capabilities.tools = false
            model.variants.push({ id: Model.VariantID.make("other") })
          }),
        )
        expect(required(yield* models.get(providerID, modelID))).toMatchObject({
          limit: { context: 100_000 },
          capabilities: { tools: false },
          variants: [{ id: "high" }, { id: "other" }],
        })
      }),
    ),
  )

  it.effect("publishes an updated event after provider changes", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const bus = yield* Bus.Service
      const updated = yield* bus
        .subscribe(Provider.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* providers.transform((editor) => editor.update(Provider.ID.make("test"), () => {}))

      expect((yield* Fiber.join(updated)).length).toBe(1)
    }),
  )

  it.effect("preserves provider identity when updating new and existing providers", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const providerID = Provider.ID.make("original")
      const renamed = Provider.ID.make("renamed")
      yield* providers.transform((editor) => {
        editor.update(providerID, (provider) => {
          provider.id = renamed
          provider.name = "Created"
        })
        expect(editor.get(providerID)?.provider.id).toBe(providerID)
        editor.update(providerID, (provider) => {
          provider.id = renamed
          provider.name = "Updated"
        })
      })

      expect(yield* providers.get(providerID)).toMatchObject({ id: providerID, name: "Updated" })
      expect(yield* providers.get(renamed)).toBeUndefined()
      expect((yield* providers.all()).map((provider) => provider.id)).toEqual([providerID])

      yield* providers.reload()
      expect(yield* providers.get(providerID)).toMatchObject({ id: providerID, name: "Updated" })
    }),
  )

  it.effect("derives availability from active credentials without changing provider state", () => {
    const integrationID = Integration.ID.make("test")
    const localProviderLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Provider.node, Credential.node]), [Location.node.replace(locationLayer)]),
    )

    return Effect.gen(function* () {
      const providers = yield* Provider.Service
      const credentials = yield* Credential.Service
      yield* providers.transform((editor) => editor.update(Provider.ID.make("test"), () => {}))
      yield* credentials.create({
        integrationID,
        label: "First",
        value: Credential.Key.make({ type: "key", key: "first", metadata: { tenant: "one" } }),
      })

      expect((yield* providers.available()).map((provider) => provider.id)).toEqual([Provider.ID.make("test")])
      expect(required(yield* providers.get(Provider.ID.make("test"))).body).toBeUndefined()
      yield* credentials.create({
        integrationID,
        label: "Second",
        value: Credential.Key.make({ type: "key", key: "second", metadata: { tenant: "two" } }),
      })
      expect((yield* providers.available()).map((provider) => provider.id)).toEqual([Provider.ID.make("test")])
      expect(required(yield* providers.get(Provider.ID.make("test"))).body).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(localProviderLayer))
  })

  it.effect("reuses the model catalog across credential switches", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const bus = yield* Bus.Service
      const providerID = Provider.ID.make("switchable")
      const integrationID = Integration.ID.make(providerID)
      yield* integrations.transform((editor) => editor.update(integrationID, () => {}))
      yield* providers.transform((editor) =>
        editor.add({
          info: Provider.Info.empty(providerID),
          models: [Model.Info.default(providerID, Model.ID.make("chat"))],
        }),
      )
      expect(yield* models.available()).toEqual([])
      const log = yield* Ref.make<string[]>([])
      yield* bus.subscribe().pipe(
        Stream.runForEach((event) => Ref.update(log, (types) => [...types, event.type])),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.yieldNow
      const updates = Ref.get(log).pipe(
        Effect.map((types) => types.filter((type) => type === Model.Event.Updated.type).length),
      )

      const first = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "first" }),
      })
      const materialized = yield* models.available()
      expect(materialized).toHaveLength(1)
      // Credential events reach Model on other fibers; let the connect land before switching.
      yield* settle(updates.pipe(Effect.map((count) => count >= 1)))

      const second = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "second" }),
      })
      expect(yield* models.available()).toBe(materialized)
      yield* credentials.activate(first.id)
      expect(yield* models.available()).toBe(materialized)
      yield* credentials.remove(first.id)
      expect(yield* models.available()).toBe(materialized)

      // Disconnecting is a real change whose model.updated follows every earlier one in the log,
      // so once it has arrived the total shows whether any switch above published as well.
      yield* credentials.remove(second.id)
      expect(yield* models.available()).toEqual([])
      yield* settle(
        Ref.get(log).pipe(
          Effect.map(
            (types) =>
              types.lastIndexOf(Model.Event.Updated.type) > types.lastIndexOf(Credential.Event.Updated.type),
          ),
        ),
      )
      expect(yield* updates).toBe(2)
    }),
  )

  it.effect("persists direct edits to models returned by list and get", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("direct")
      const listed = Model.ID.make("listed")
      const fetched = Model.ID.make("fetched")
      const definitions = [Model.Info.default(providerID, listed), Model.Info.default(providerID, fetched)]
      yield* providers.transform((editor) =>
        editor.add({ info: { ...Provider.Info.empty(providerID), activation: "enabled" }, models: definitions }),
      )
      yield* models.transform((editor) => {
        editor.list(providerID).forEach((model) => {
          model.limit.context = 4096
        })
        required(editor.get(providerID, fetched)).capabilities.input.push("pdf")
      })

      expect(yield* models.get(providerID, listed)).toMatchObject({
        limit: { context: 4096 },
        capabilities: { input: ["text", "image"] },
      })
      expect(yield* models.get(providerID, fetched)).toMatchObject({
        limit: { context: 4096 },
        capabilities: { input: ["text", "image", "pdf"] },
      })
      expect(definitions.map((model) => model.limit.context)).toEqual([200_000, 200_000])
    }),
  )

  it.effect("gives foreign definitions the registering provider's identity", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const source = Provider.ID.make("source")
      const mirror = Provider.ID.make("mirror")
      const modelID = Model.ID.make("chat")
      const definitions = [Model.Info.default(source, modelID)]
      yield* providers.transform((editor) => {
        editor.add({ info: { ...Provider.Info.empty(source), activation: "enabled" }, models: definitions })
        editor.add({ info: { ...Provider.Info.empty(mirror), activation: "enabled" }, models: definitions })
      })

      expect((yield* models.available()).map((model) => model.providerID).toSorted()).toEqual([mirror, source])
      expect(yield* models.get(mirror, modelID)).toMatchObject({ id: modelID, providerID: mirror })
      expect((yield* providers.snapshot()).records.get(source)?.models.get(modelID)).toBe(definitions[0])
    }),
  )

  it.effect("keeps materialized models when another provider becomes available", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const existing = Provider.ID.make("existing")
      const added = Provider.ID.make("added")
      const edited = Model.ID.make("edited")
      const untouched = Model.ID.make("untouched")
      yield* integrations.transform((editor) => editor.update(Integration.ID.make(added), () => {}))
      yield* providers.transform((editor) => {
        editor.add({
          info: { ...Provider.Info.empty(existing), activation: "enabled" },
          models: [Model.Info.default(existing, edited), Model.Info.default(existing, untouched)],
        })
        editor.add({ info: Provider.Info.empty(added), models: [Model.Info.default(added, Model.ID.make("chat"))] })
      })
      yield* models.transform((editor) =>
        editor.update(existing, edited, (model) => {
          model.limit.context = 1
        }),
      )
      const before = required(yield* models.get(existing, untouched))

      yield* credentials.create({
        integrationID: Integration.ID.make(added),
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })
      expect((yield* models.available()).map((model) => model.providerID).toSorted()).toEqual([
        added,
        existing,
        existing,
      ])
      expect(yield* models.get(existing, untouched)).toBe(before)
      expect(yield* models.get(existing, edited)).toMatchObject({ limit: { context: 1 } })
    }),
  )

  it.effect("derives availability from a provider's integration", () => {
    const integrationID = Integration.ID.make("gateway")
    const providerID = Provider.ID.make("remote")
    const localProviderLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Provider.node, Credential.node, Integration.node]), [
        Location.node.replace(locationLayer),
      ]),
    )

    return Effect.gen(function* () {
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => editor.update(integrationID, () => {}))
      yield* providers.transform((editor) =>
        editor.update(providerID, (provider) => {
          provider.integrationID = integrationID
        }),
      )
      expect(yield* providers.available()).toEqual([])

      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect((yield* providers.available()).map((provider) => provider.id)).toEqual([providerID])
    }).pipe(Effect.scoped, Effect.provide(localProviderLayer))
  })

  it.effect("makes an explicitly enabled provider available without a connection", () => {
    const integrationID = Integration.ID.make("gateway")
    const providerID = Provider.ID.make("remote")
    const localProviderLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Provider.node, Credential.node, Integration.node]), [
        Location.node.replace(locationLayer),
      ]),
    )

    return Effect.gen(function* () {
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => editor.update(integrationID, () => {}))
      yield* providers.transform((editor) =>
        editor.update(providerID, (provider) => {
          provider.integrationID = integrationID
          provider.settings = { baseURL: "https://gateway.example.com/v1" }
        }),
      )
      expect(yield* providers.available()).toEqual([])

      yield* providers.transform((editor) =>
        editor.update(providerID, (provider) => {
          provider.activation = "enabled"
        }),
      )
      expect((yield* providers.available()).map((provider) => provider.id)).toEqual([providerID])
    }).pipe(Effect.scoped, Effect.provide(localProviderLayer))
  })

  it.effect("projects environment connections without a catalog plugin", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.CATALOG_TEST_API_KEY
        process.env.CATALOG_TEST_API_KEY = "secret"
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const providers = yield* Provider.Service
          const integrations = yield* Integration.Service
          const providerID = Provider.ID.make("test")
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID: Integration.ID.make(providerID),
              method: { type: "env", names: ["CATALOG_TEST_API_KEY"] },
            }),
          )
          yield* providers.transform((editor) => editor.update(providerID, () => {}))

          expect((yield* providers.available()).map((provider) => provider.id)).toContain(providerID)
        }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.CATALOG_TEST_API_KEY
          else process.env.CATALOG_TEST_API_KEY = previous
        }),
    ),
  )

  it.effect("stores provider package settings", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const providerID = Provider.ID.make("test")
      yield* providers.transform((editor) =>
        editor.update(providerID, (provider) => {
          provider.package = Provider.aisdk("custom-sdk")
          provider.settings = { baseURL: "https://override.example.com" }
        }),
      )

      expect(required(yield* providers.get(providerID))).toMatchObject({
        package: Provider.aisdk("custom-sdk"),
        settings: { baseURL: "https://override.example.com" },
      })
    }),
  )

  it.effect("uses model package settings over provider settings", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("test")
      const modelID = Model.ID.make("model")
      yield* providers.transform((editor) => {
        editor.update(providerID, (provider) => {
          provider.package = Provider.aisdk("custom-sdk")
          provider.settings = { baseURL: "https://provider.example.com" }
        })
      })
      yield* models.transform((editor) => {
        editor.update(providerID, modelID, (model) => {
          model.modelID = Model.ID.make("upstream-model")
          model.package = Provider.aisdk("custom-sdk")
          model.settings = { baseURL: "https://override.example.com" }
        })
      })

      expect(required(yield* models.get(providerID, modelID))).toMatchObject({
        modelID: Model.ID.make("upstream-model"),
        package: Provider.aisdk("custom-sdk"),
        settings: { baseURL: "https://override.example.com" },
      })
    }),
  )

  it.effect("resolves default model package settings from the provider", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("test")
      const modelID = Model.ID.make("model")
      yield* providers.transform((editor) => {
        editor.update(providerID, (provider) => {
          provider.package = Provider.aisdk("custom-sdk")
          provider.settings = { baseURL: "https://provider.example.com" }
        })
        editor.models.update(providerID, modelID, () => {})
      })

      expect(required(yield* models.get(providerID, modelID))).toMatchObject({
        package: Provider.aisdk("custom-sdk"),
        settings: { baseURL: "https://provider.example.com" },
      })
    }),
  )

  it.effect("rewrites AI SDK packages and their options on write", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("bedrock")
      const modelID = Model.ID.make("claude")
      yield* providers.transform((editor) => {
        editor.update(providerID, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
          provider.settings = { region: "us-east-1", extraBody: { tag: "provider" } }
        })
        editor.models.update(providerID, modelID, () => {})
        editor.update(Provider.ID.make("gitlab"), (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/gitlab")
          provider.settings = { extraBody: { kept: true } }
        })
      })
      yield* models.transform((editor) => {
        editor.update(providerID, modelID, (model) => {
          model.modelID = Model.ID.make("anthropic.claude-opus-4-8")
          model.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
          model.settings = { reasoningConfig: { type: "adaptive", maxReasoningEffort: "high" } }
          model.variants = [
            {
              id: Model.VariantID.make("max"),
              settings: { reasoningConfig: { type: "adaptive", maxReasoningEffort: "max" } },
            },
          ]
        })
      })

      expect(required(yield* providers.get(providerID))).toMatchObject({
        package: "@opencode/ai/providers/amazon-bedrock",
        settings: { region: "us-east-1" },
        body: { tag: "provider" },
      })
      const model = required(yield* models.get(providerID, modelID))
      expect(model.package).toBe("@opencode/ai/providers/amazon-bedrock")
      expect(model.settings).not.toHaveProperty("reasoningConfig")
      expect(model.body).toMatchObject({
        additionalModelRequestFields: { thinking: { type: "adaptive" }, output_config: { effort: "high" } },
      })
      expect(model.variants).toEqual([
        {
          id: Model.VariantID.make("max"),
          settings: {},
          body: { additionalModelRequestFields: { thinking: { type: "adaptive" }, output_config: { effort: "max" } } },
        },
      ])
      expect(required(yield* providers.get(Provider.ID.make("gitlab")))).toMatchObject({
        package: Provider.aisdk("@ai-sdk/gitlab"),
        settings: { extraBody: { kept: true } },
      })
    }),
  )

  it.effect("resolves provider and model overlay merges", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("test")
      const modelID = Model.ID.make("model")
      yield* providers.transform((editor) => {
        editor.update(providerID, (provider) => {
          provider.settings = { provider: true, shared: "provider" }
          provider.headers = { provider: "provider", shared: "provider" }
          provider.body = { provider: true, shared: "provider" }
        })
      })
      yield* models.transform((editor) => {
        editor.update(providerID, modelID, (model) => {
          model.settings = { model: true, shared: "model" }
          model.headers = { model: "model", shared: "model" }
          model.body = { model: true, shared: "model" }
        })
      })

      const model = required(yield* models.get(providerID, modelID))
      expect(model.settings).toEqual({ provider: true, shared: "model", model: true })
      expect(model.headers).toEqual({ provider: "provider", shared: "model", model: "model" })
      expect(model.body).toEqual({ provider: true, shared: "model", model: true })
    }),
  )

  it.effect("falls back to newest available model when no default is configured", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("test")
      yield* providers.transform((editor) => {
        editor.update(providerID, () => {})
        editor.models.update(providerID, Model.ID.make("old"), (model) => {
          model.time.released = 1000
        })
        editor.models.update(providerID, Model.ID.make("new"), (model) => {
          model.time.released = 2000
        })
      })

      expect((yield* models.default())?.id).toMatch("new")
    }),
  )

  it.effect("uses a transform-provided default model until that transform is replaced", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("test")
      const old = Model.ID.make("old")
      const newest = Model.ID.make("new")
      yield* providers.transform((editor) => {
        editor.update(providerID, () => {})
        editor.models.update(providerID, old, (model) => {
          model.time.released = 1000
        })
        editor.models.update(providerID, newest, (model) => {
          model.time.released = 2000
        })
      })

      let configured = true
      yield* models.transform((editor) => {
        if (configured) editor.default.set(providerID, old)
      })
      expect((yield* models.default())?.id).toBe(old)

      configured = false
      yield* models.reload()
      expect((yield* models.default())?.id).toBe(newest)
    }),
  )

  it.effect("ignores a configured default on a disabled provider", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const disabledProvider = Provider.ID.make("disabled")
      const enabledProvider = Provider.ID.make("enabled")
      const disabledModel = Model.ID.make("configured")
      const fallbackModel = Model.ID.make("fallback")
      yield* providers.transform((editor) => {
        editor.update(disabledProvider, (provider) => {
          provider.activation = "disabled"
        })
        editor.models.update(disabledProvider, disabledModel, () => {})
        editor.update(enabledProvider, () => {})
        editor.models.update(enabledProvider, fallbackModel, () => {})
      })
      yield* models.transform((editor) => editor.default.set(disabledProvider, disabledModel))

      expect(yield* models.default()).toMatchObject({
        providerID: enabledProvider,
        id: fallbackModel,
      })
    }),
  )

  it.effect("small model uses the newest release in the first matching family", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("test")
      yield* providers.transform((editor) => {
        editor.update(providerID, () => {})
        editor.models.update(providerID, Model.ID.make("newer-flash"), (model) => {
          model.family = Model.Family.make("gemini-flash")
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.time.released = 3000
        })
        editor.models.update(providerID, Model.ID.make("older-luna"), (model) => {
          model.family = Model.Family.make("gpt-luna")
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.time.released = 1000
        })
        editor.models.update(providerID, Model.ID.make("newer-luna"), (model) => {
          model.family = Model.Family.make("gpt-luna")
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.time.released = 2000
        })
      })

      expect((yield* models.small(providerID))?.id).toBe(Model.ID.make("newer-luna"))
    }),
  )

  it.effect("small model returns undefined without a matching family", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("test")
      yield* providers.transform((editor) => {
        editor.update(providerID, () => {})
        editor.models.update(providerID, Model.ID.make("large"), (model) => {
          model.family = Model.Family.make("gpt")
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
        })
      })

      expect(yield* models.small(providerID)).toBeUndefined()
    }),
  )
})

// Bus subscribers run on their own fibers, so give them turns until the condition holds.
const settle = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (yield* condition) return
    yield* Effect.yieldNow
  }
  return yield* Effect.die("Timed out waiting for catalog events")
})
