import { AISDK } from "@opencode/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Npm } from "@opencode/util/npm"
import { SapAICorePlugin } from "@opencode/core/plugin/provider/sap-ai-core"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const fixtureProvider = new URL("./fixtures/provider-factory.ts", import.meta.url).href
const it = testEffect(PluginTestLayer)
const npm = Npm.Service.of({
  add: (name) => Effect.succeed({ directory: "", name }),
  resolve: (name) => Effect.succeed({ directory: "", name }),
  check: () => Effect.succeed(false),
  update: (name) => Effect.succeed({ directory: "", name }),
  which: () => Effect.undefined,
})

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* SapAICorePlugin.effect(host).pipe(Effect.provideService(Npm.Service, npm))
})

function model(providerID: string) {
  return Model.Info.make({
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make("sap-model")),
    modelID: Model.ID.make("sap-model"),
    package: Provider.aisdk(fixtureProvider),
  })
}

describe("SapAICorePlugin", () => {
  it.effect("passes a stored credential through the model resolver to the SAP SDK", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const aisdk = yield* AISDK.Service
          const credentials = yield* Credential.Service
          yield* addPlugin()
          const created = yield* credentials.create({
            integrationID: Integration.ID.make("sap-ai-core"),
            value: Credential.Key.make({ type: "key", key: "saved-service-key" }),
          })
          const stored = yield* credentials.get(created.id)
          const resolved = yield* ModelResolver.fromCatalogModel(model("sap-ai-core"), stored?.value, {
            loadAISDK: aisdk.model,
          })
          expect(process.env.AICORE_SERVICE_KEY).toBe("saved-service-key")
          expect(String(resolved.provider)).toBe("sap-ai-core")
        }),
    ),
  )

  it.effect("copies serviceKey option into AICORE_SERVICE_KEY but keeps SDK options to deployment metadata", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const sdk = yield* aisdk.runSDK({
            model: model("sap-ai-core"),
            package: fixtureProvider,
            options: { name: "sap-ai-core", serviceKey: "service-key", apiKey: "saved-service-key" },
          })
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
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const sdk = yield* aisdk.runSDK({
            model: model("sap-ai-core"),
            package: fixtureProvider,
            options: { name: "sap-ai-core", serviceKey: "option-service-key", apiKey: "saved-service-key" },
          })
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
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const sdk = yield* aisdk.runSDK({
            model: model("sap-ai-core"),
            package: fixtureProvider,
            options: { name: "sap-ai-core", apiKey: 42 },
          })
          expect(process.env.AICORE_SERVICE_KEY).toBeUndefined()
          expect(sdk.sdk.options).toEqual({})
        }),
    ),
  )

  it.effect("uses the callable SDK for language selection", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const sdk = Object.assign((modelID: string) => ({ modelID, provider: "callable" }), {
        languageModel() {
          throw new Error("SAP AI Core should call the SDK directly")
        },
      })
      const language = yield* aisdk.runLanguage({ model: model("sap-ai-core"), sdk, options: {} })
      expect(language.language as unknown).toEqual({ modelID: "sap-model", provider: "callable" })
    }),
  )

  it.effect("ignores non-SAP AI Core providers", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const sdk = yield* aisdk.runSDK({
            model: model("openai"),
            package: fixtureProvider,
            options: { name: "openai", serviceKey: "service-key", apiKey: "saved-service-key" },
          })
          const language = yield* aisdk.runLanguage({
            model: model("openai"),
            sdk: () => {
              throw new Error("SAP AI Core should ignore other providers")
            },
            options: {},
          })
          expect(process.env.AICORE_SERVICE_KEY).toBeUndefined()
          expect(sdk.sdk).toBeUndefined()
          expect(language.language).toBeUndefined()
        }),
    ),
  )
})
