import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { Npm } from "@opencode-ai/core/npm"
import { SapAICorePlugin } from "@opencode-ai/core/plugin/provider/sap-ai-core"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const fixtureProvider = new URL("./fixtures/provider-factory.ts", import.meta.url).href
const it = testEffect(PluginTestLayer)
const npm = Npm.Service.of({
  add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
  install: () => Effect.void,
  which: () => Effect.succeed(undefined),
})

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: SapAICorePlugin.id, effect: SapAICorePlugin.effect({ ...host, npm }) })
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(vars)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}

function model(providerID: string) {
  return new ModelV2.Info({
    ...ModelV2.Info.empty(ProviderV2.ID.make(providerID), ModelV2.ID.make("sap-model")),
    api: { id: ModelV2.ID.make("sap-model"), type: "aisdk", package: fixtureProvider },
  })
}

describe("SapAICorePlugin", () => {
  it.effect("copies serviceKey option into AICORE_SERVICE_KEY but keeps SDK options to deployment metadata", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* addPlugin()
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("sap-ai-core"),
              package: fixtureProvider,
              options: { name: "sap-ai-core", serviceKey: "service-key" },
            },
            {},
          )
          expect(process.env.AICORE_SERVICE_KEY).toBe("service-key")
          expect(sdk.sdk.options).toEqual({ deploymentId: "deployment", resourceGroup: "resource-group" })
        }),
    ),
  )

  it.effect("preserves existing AICORE_SERVICE_KEY over serviceKey option", () =>
    withEnv(
      {
        AICORE_SERVICE_KEY: "env-service-key",
        AICORE_DEPLOYMENT_ID: "deployment",
        AICORE_RESOURCE_GROUP: "resource-group",
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* addPlugin()
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("sap-ai-core"),
              package: fixtureProvider,
              options: { name: "sap-ai-core", serviceKey: "option-service-key" },
            },
            {},
          )
          expect(process.env.AICORE_SERVICE_KEY).toBe("env-service-key")
          expect(sdk.sdk.options).toEqual({ deploymentId: "deployment", resourceGroup: "resource-group" })
        }),
    ),
  )

  it.effect("omits deployment and resourceGroup SDK options when no service key is available", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* addPlugin()
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            { model: model("sap-ai-core"), package: fixtureProvider, options: { name: "sap-ai-core" } },
            {},
          )
          expect(process.env.AICORE_SERVICE_KEY).toBeUndefined()
          expect(sdk.sdk.options).toEqual({})
        }),
    ),
  )

  it.effect("uses the callable SDK for language selection", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const sdk = Object.assign((modelID: string) => ({ modelID, provider: "callable" }), {
        languageModel() {
          throw new Error("SAP AI Core should call the SDK directly")
        },
      })
      const language = yield* plugin.trigger(
        "aisdk.language",
        { model: model("sap-ai-core"), sdk, options: {} },
        {},
      )
      expect(language.language as unknown).toEqual({ modelID: "sap-model", provider: "callable" })
    }),
  )

  it.effect("ignores non-SAP AI Core providers", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* addPlugin()
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("openai"),
              package: fixtureProvider,
              options: { name: "openai", serviceKey: "service-key" },
            },
            {},
          )
          const language = yield* plugin.trigger(
            "aisdk.language",
            {
              model: model("openai"),
              sdk: () => {
                throw new Error("SAP AI Core should ignore other providers")
              },
              options: {},
            },
            {},
          )
          expect(process.env.AICORE_SERVICE_KEY).toBeUndefined()
          expect(sdk.sdk).toBeUndefined()
          expect(language.language).toBeUndefined()
        }),
    ),
  )
})
