import { expect } from "bun:test"
import { Context, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { State } from "@opencode/core/state"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

it.effect("composes source, configuration, and restriction plugins across reload and unload", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const models = yield* Model.Service
    const providers = yield* Provider.Service
    const providerID = Provider.ID.make("company")
    const chat = Model.ID.make("chat")
    const fast = Model.ID.make("fast")
    const inventory = {
      models: [
        { ...Model.Info.default(providerID, chat), settings: { temperature: 0.7 } },
        Model.Info.default(providerID, fast),
      ],
    }
    const source: Plugin.Generation = {
      id: "model-source",
      revision: "1",
      effect: (ctx) =>
        ctx.provider
          .transform((editor) =>
            editor.add({
              info: { ...Provider.Info.empty(providerID), activation: "enabled" },
              models: inventory.models,
            }),
          )
          .pipe(Effect.asVoid),
    }
    const configuration: Plugin.Generation = {
      ...fromPromise({
        id: "company-configuration",
        async setup(ctx) {
          await ctx.provider.transform((editor) =>
            editor.update("company", (provider) => {
              provider.settings = { baseURL: "https://company.example/v1", temperature: 0.2 }
              provider.headers = { "x-team": "engineering" }
            }),
          )
          await ctx.model.transform((editor) =>
            editor.update("company", "chat", (model) => {
              model.limit.context = 16_384
            }),
          )
        },
      }),
      revision: "1",
    }
    const restriction: Plugin.Generation = {
      id: "context-budget",
      revision: "1",
      effect: (ctx) =>
        ctx.model
          .transform((editor) => {
            for (const model of editor.list()) {
              editor.update(model.providerID, model.id, (draft) => {
                draft.limit.context = Math.min(draft.limit.context, 4096)
              })
            }
            if (editor.get(providerID, fast) && editor.get(providerID, chat)?.limit.context === 4096) {
              editor.update(providerID, fast, (model) => {
                model.name = "Budget fallback"
              })
            }
          })
          .pipe(Effect.asVoid),
    }

    yield* plugins.activate([source, configuration, restriction])
    expect(yield* models.get(providerID, chat)).toMatchObject({
      limit: { context: 4096 },
      settings: { baseURL: "https://company.example/v1", temperature: 0.7 },
      headers: { "x-team": "engineering" },
    })
    expect(yield* models.get(providerID, fast)).toMatchObject({
      name: "Budget fallback",
      settings: { baseURL: "https://company.example/v1", temperature: 0.2 },
    })

    const previous = yield* models.available()
    const replacement = Model.ID.make("replacement")
    inventory.models = [Model.Info.default(providerID, replacement)]
    yield* providers.reload()
    expect((yield* models.available()).map((model) => model.id)).toEqual([replacement, chat])
    expect(yield* models.get(providerID, replacement)).toMatchObject({ limit: { context: 4096 } })
    expect(yield* models.get(providerID, fast)).toBeUndefined()
    expect(previous.find((model) => model.id === fast)?.name).toBe("Budget fallback")

    yield* plugins.activate([source, configuration])
    expect(yield* models.get(providerID, chat)).toMatchObject({ limit: { context: 16_384 } })
    expect(yield* models.get(providerID, replacement)).toMatchObject({ limit: { context: 200_000 } })
    yield* plugins.activate([])
    expect(yield* providers.all()).toEqual([])
    expect(yield* models.available()).toEqual([])
  }),
)

it.effect("shares a plugin's definitions across locations while keeping model edits and cached results local", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const providers = yield* Provider.Service
    const models = yield* Model.Service
    const scope = yield* Scope.Scope
    const other = yield* Layer.build(Layer.fresh(PluginTestLayer)).pipe(Scope.provide(scope))
    const otherPlugins = Context.get(other, Plugin.Service)
    const otherProviders = Context.get(other, Provider.Service)
    const otherModels = Context.get(other, Model.Service)
    const providerID = Provider.ID.make("shared-source")
    const modelID = Model.ID.make("chat")
    const definitions = [Model.Info.default(providerID, modelID)]
    const source: Plugin.Generation = {
      id: "shared-source",
      revision: "1",
      effect: (ctx) =>
        ctx.provider
          .transform((editor) =>
            editor.add({
              info: { ...Provider.Info.empty(providerID), activation: "enabled" },
              models: definitions,
            }),
          )
          .pipe(Effect.asVoid),
    }
    yield* plugins.activate([
      source,
      {
        id: "local-policy",
        revision: "1",
        effect: (ctx) =>
          ctx.model
            .transform((editor) =>
              editor.update(providerID, modelID, (model) => {
                model.limit.context = 4096
                model.capabilities.input.push("pdf")
              }),
            )
            .pipe(Effect.asVoid),
      },
    ])
    yield* otherPlugins.activate([source])

    const templates = (yield* providers.snapshot()).records.get(providerID)?.models
    expect(templates).toBe((yield* otherProviders.snapshot()).records.get(providerID)?.models)
    expect(templates?.get(modelID)).toBe(definitions[0])
    const first = yield* models.available()
    expect(yield* models.available()).toBe(first)
    expect(yield* models.get(providerID, modelID)).toBe(first[0])
    expect(first[0]).toMatchObject({ limit: { context: 4096 }, capabilities: { input: ["text", "image", "pdf"] } })
    expect(yield* otherModels.get(providerID, modelID)).toMatchObject({
      limit: { context: 200_000 },
      capabilities: { input: ["text", "image"] },
    })
    expect(definitions[0]?.limit.context).toBe(200_000)
    expect(definitions[0]?.capabilities.input).toEqual(["text", "image"])
  }),
)

it.effect("replays cross-provider policies when shared access changes, including reads inside a batch", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const providers = yield* Provider.Service
    const models = yield* Model.Service
    const credentials = yield* Credential.Service
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const integrationID = Integration.ID.make("gateway")
    const premium = Provider.ID.make("premium")
    const backup = Provider.ID.make("backup")
    const local = Provider.ID.make("local")
    const modelID = Model.ID.make("chat")
    yield* plugins.activate([
      {
        id: "gateway-models",
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.integration.transform((editor) =>
              editor.update("gateway", (integration) => {
                integration.name = "Company gateway"
              }),
            )
            yield* ctx.provider.transform((editor) => {
              for (const id of [premium, backup])
                editor.add({
                  info: { ...Provider.Info.empty(id), integrationID },
                  models: [Model.Info.default(id, modelID)],
                })
              editor.add({
                info: { ...Provider.Info.empty(local), activation: "enabled" },
                models: [Model.Info.default(local, modelID)],
              })
            })
          }),
      },
      {
        id: "fallback-policy",
        revision: "1",
        effect: (ctx) =>
          ctx.model
            .transform((editor) => {
              const remote = editor.get(premium, modelID)
              editor.update(local, modelID, (model) => {
                model.limit.context = remote ? 4096 : 1024
              })
            })
            .pipe(Effect.asVoid),
      },
    ])

    expect((yield* models.available()).map((model) => model.providerID)).toEqual([local])
    expect(yield* models.get(local, modelID)).toMatchObject({ limit: { context: 1024 } })
    const updated = yield* bus
      .subscribe(Model.Event.Updated)
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
    const credential = yield* credentials.create({
      integrationID,
      value: Credential.Key.make({ type: "key", key: "test-gateway-key" }),
    })
    expect((yield* models.available()).map((model) => model.providerID)).toEqual([premium, backup, local])
    expect(yield* models.get(local, modelID)).toMatchObject({ limit: { context: 4096 } })
    expect((yield* Fiber.join(updated))[0]?.location).toMatchObject({ directory: location.directory })

    const disabled = yield* State.batch(
      Effect.gen(function* () {
        const registration = yield* providers.transform((editor) =>
          editor.update(premium, (provider) => {
            provider.activation = "disabled"
          }),
        )
        expect((yield* models.available()).map((model) => model.providerID)).toEqual([backup, local])
        expect(yield* models.get(local, modelID)).toMatchObject({ limit: { context: 1024 } })
        return registration
      }),
    )
    yield* disabled.dispose
    expect(yield* models.get(local, modelID)).toMatchObject({ limit: { context: 4096 } })

    yield* credentials.remove(credential.id)
    expect((yield* models.available()).map((model) => model.providerID)).toEqual([local])
    expect(yield* models.get(local, modelID)).toMatchObject({ limit: { context: 1024 } })
    expect((yield* providers.snapshot()).records.get(premium)?.models.has(modelID)).toBe(true)
  }),
)

it.effect("removes a failed model plugin's access and providers without retaining its partial model edits", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const models = yield* Model.Service
    const providers = yield* Provider.Service
    const integrations = yield* Integration.Service
    const healthy = Provider.ID.make("healthy")
    const broken = Provider.ID.make("broken")
    const modelID = Model.ID.make("chat")
    const state = { fail: false, cleaned: false }
    yield* plugins.activate([
      {
        id: "healthy-source",
        revision: "1",
        effect: (ctx) =>
          ctx.provider
            .transform((editor) =>
              editor.add({
                info: { ...Provider.Info.empty(healthy), activation: "enabled" },
                models: [Model.Info.default(healthy, modelID)],
              }),
            )
            .pipe(Effect.asVoid),
      },
      {
        id: "broken-plugin",
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                state.cleaned = true
              }),
            )
            yield* ctx.integration.transform((editor) => editor.update("broken", () => {}))
            yield* ctx.provider.transform((editor) =>
              editor.add({
                info: {
                  ...Provider.Info.empty(broken),
                  activation: "enabled",
                  integrationID: Integration.ID.make("broken"),
                },
                models: [Model.Info.default(broken, modelID)],
              }),
            )
            yield* ctx.model.transform((editor) => {
              if (!state.fail) return
              editor.update(healthy, modelID, (model) => {
                model.name = "partial broken edit"
              })
              throw new Error("expected replay failure")
            })
          }),
      },
      {
        id: "healthy-policy",
        revision: "1",
        effect: (ctx) =>
          ctx.model
            .transform((editor) =>
              editor.update(healthy, modelID, (model) => {
                model.limit.context = 4096
              }),
            )
            .pipe(Effect.asVoid),
      },
    ])
    expect((yield* models.available()).map((model) => model.providerID)).toEqual([healthy, broken])

    state.fail = true
    yield* models.reload()
    yield* plugins.awaitActivation
    expect(state.cleaned).toBe(true)
    expect((yield* plugins.list()).find((plugin) => plugin.id === "broken-plugin")?.state).toMatchObject({
      status: "failed",
      error: expect.stringContaining("model.transform failed"),
    })
    expect(yield* providers.get(broken)).toBeUndefined()
    expect(yield* integrations.get(Integration.ID.make("broken"))).toBeUndefined()
    expect((yield* models.available()).map((model) => model.providerID)).toEqual([healthy])
    expect(yield* models.get(healthy, modelID)).toMatchObject({ name: "chat", limit: { context: 4096 } })
  }),
)

it.effect("hides an account-specific inventory after switching credentials until its source refreshes", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service
    const providers = yield* Provider.Service
    const models = yield* Model.Service
    const integrationID = Integration.ID.make("console")
    const providerID = Provider.ID.make("console-models")
    const access: Plugin.Generation = {
      id: "console-access",
      revision: "1",
      effect: (ctx) => ctx.integration.transform((editor) => editor.update("console", () => {})).pipe(Effect.asVoid),
    }
    yield* plugins.activate([access])
    yield* credentials.create({ integrationID, value: Credential.Key.make({ type: "key", key: "account-one" }) })
    const inventory = {
      connection: yield* integrations.connection.active(integrationID),
      models: [Model.Info.default(providerID, Model.ID.make("account-one-model"))],
    }
    yield* plugins.activate([
      access,
      {
        id: "console-discovery",
        revision: "1",
        effect: (ctx) =>
          ctx.provider
            .transform((editor) =>
              editor.add({
                info: { ...Provider.Info.empty(providerID), integrationID },
                models: inventory.models,
                sourceConnection: inventory.connection,
              }),
            )
            .pipe(Effect.asVoid),
      },
    ])
    const previous = yield* models.available()
    expect(previous.map((model) => model.id)).toEqual([Model.ID.make("account-one-model")])

    yield* credentials.create({ integrationID, value: Credential.Key.make({ type: "key", key: "account-two" }) })
    expect(yield* providers.available()).toEqual([])
    expect(yield* models.available()).toEqual([])

    inventory.connection = yield* integrations.connection.active(integrationID)
    inventory.models = [Model.Info.default(providerID, Model.ID.make("account-two-model"))]
    yield* providers.reload()
    expect((yield* models.available()).map((model) => model.id)).toEqual([Model.ID.make("account-two-model")])
    expect(previous.map((model) => model.id)).toEqual([Model.ID.make("account-one-model")])
  }),
)

it.effect(
  "derives a custom provider from inactive templates independently of the upstream account's model policies",
  () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      const upstream = Provider.ID.make("upstream")
      const custom = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      const definition = Model.Info.default(upstream, modelID)
      yield* plugins.activate([
        {
          id: "upstream-source",
          revision: "1",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.integration.transform((editor) => editor.update("upstream", () => {}))
              yield* ctx.provider.transform((editor) =>
                editor.add({
                  info: { ...Provider.Info.empty(upstream), integrationID: Integration.ID.make("upstream") },
                  models: [definition],
                }),
              )
              yield* ctx.model.transform((editor) =>
                editor.update(upstream, modelID, (model) => {
                  model.limit.context = 4096
                }),
              )
            }),
        },
        {
          id: "custom-endpoint",
          revision: "1",
          effect: (ctx) =>
            ctx.provider
              .transform((editor) => {
                const source = editor.get(upstream)
                if (!source) return
                editor.add({
                  info: {
                    ...source.provider,
                    id: custom,
                    integrationID: undefined,
                    activation: "enabled",
                    settings: { baseURL: "https://custom.example/v1" },
                  },
                  models: Array.from(source.models.values()),
                })
                editor.models.update(custom, modelID, (model) => {
                  model.limit.context = 32_768
                })
              })
              .pipe(Effect.asVoid),
        },
      ])

      expect(yield* models.get(upstream, modelID)).toBeUndefined()
      expect(yield* models.get(custom, modelID)).toMatchObject({
        providerID: custom,
        limit: { context: 32_768 },
        settings: { baseURL: "https://custom.example/v1" },
      })
      expect((yield* providers.snapshot()).records.get(upstream)?.models.get(modelID)).toBe(definition)
      expect(definition.limit.context).toBe(200_000)

      yield* credentials.create({
        integrationID: Integration.ID.make("upstream"),
        value: Credential.Key.make({ type: "key", key: "upstream-account" }),
      })
      expect(yield* models.get(upstream, modelID)).toMatchObject({ limit: { context: 4096 } })
      expect(yield* models.get(custom, modelID)).toMatchObject({ limit: { context: 32_768 } })
    }),
)
