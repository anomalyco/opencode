import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { SapAICorePlugin } from "@opencode-ai/core/plugin/provider/sap-ai-core"
import { fixtureProvider, it, model, npmLayer, withEnv } from "./provider-helper"

const pluginWithNpm = { id: SapAICorePlugin.id, effect: SapAICorePlugin.effect.pipe(Effect.provide(npmLayer)) }

describe("SapAICorePlugin", () => {
  it.effect("copies serviceKey option into AICORE_SERVICE_KEY but keeps SDK options to deployment metadata", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* plugin.add(pluginWithNpm)
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("sap-ai-core", "sap-model"),
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
          yield* plugin.add(pluginWithNpm)
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("sap-ai-core", "sap-model"),
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
          yield* plugin.add(pluginWithNpm)
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            { model: model("sap-ai-core", "sap-model"), package: fixtureProvider, options: { name: "sap-ai-core" } },
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
      yield* plugin.add(pluginWithNpm)
      const sdk = Object.assign((modelID: string) => ({ modelID, provider: "callable" }), {
        languageModel() {
          throw new Error("SAP AI Core should call the SDK directly")
        },
      })
      const language = yield* plugin.trigger(
        "aisdk.language",
        { model: model("sap-ai-core", "sap-model"), sdk, options: {} },
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
          yield* plugin.add(pluginWithNpm)
          const sdk = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("openai", "sap-model"),
              package: fixtureProvider,
              options: { name: "openai", serviceKey: "service-key" },
            },
            {},
          )
          const language = yield* plugin.trigger(
            "aisdk.language",
            {
              model: model("openai", "sap-model"),
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
