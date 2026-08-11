import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { KimiForCodingPlugin } from "@opencode-ai/core/plugin/provider/kimi-for-coding"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = ProviderV2.ID.make("kimi-for-coding")
const methodID = Integration.MethodID.make("device")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* KimiForCodingPlugin.effect(host)
})

const addProvider = Effect.fn(function* () {
  const catalog = yield* Catalog.Service
  yield* catalog.transform((draft) => {
    draft.provider.update(providerID, (provider) => {
      provider.name = "Kimi For Coding"
      provider.package = ProviderV2.aisdk("@ai-sdk/anthropic")
      provider.settings = { baseURL: "https://api.kimi.com/coding/v1" }
      provider.headers = { "X-Custom": "preserved" }
    })
    draft.model.update(providerID, ModelV2.ID.make("k3"), () => {})
  })
})

describe("KimiForCodingPlugin", () => {
  it.effect("runs before generic Anthropic and OpenAI-compatible transforms", () =>
    Effect.sync(() => {
      const ids = ProviderPlugins.map((plugin) => plugin.id)
      const index = ids.indexOf("opencode.provider.kimi-for-coding")
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(ids.indexOf("opencode.provider.anthropic"))
      expect(index).toBeLessThan(ids.indexOf("opencode.provider.openai-compatible"))
    }),
  )

  it.effect("registers Kimi Code subscription OAuth", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("kimi-for-coding")))?.methods).toEqual([
        {
          id: methodID,
          type: "oauth",
          label: "Kimi Code subscription (OAuth)",
        },
      ])
    }),
  )

  it.effect("adds Kimi device identity headers for OAuth connections", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      yield* addProvider()
      yield* credentials.create({
        integrationID: Integration.ID.make("kimi-for-coding"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
        }),
      })
      yield* addPlugin()

      const provider = yield* catalog.provider.get(providerID)
      expect(provider?.package).toBe(ProviderV2.aisdk("@ai-sdk/openai-compatible"))
      expect(provider?.headers?.["X-Custom"]).toBe("preserved")
      expect(provider?.headers?.["X-Msh-Platform"]).toBe("kimi_code_cli")
      expect(provider?.headers?.["X-Msh-Device-Id"]).toMatch(/^[0-9a-f-]+$/)
      expect(provider?.headers?.["User-Agent"]).toStartWith("opencode/")
      expect(provider?.headers?.["Content-Type"]).toBeUndefined()
    }),
  )

  it.effect("leaves API-key connections unchanged", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      yield* addProvider()
      yield* credentials.create({
        integrationID: Integration.ID.make("kimi-for-coding"),
        value: Credential.Key.make({ type: "key", key: "sk-kimi" }),
      })
      yield* addPlugin()

      const provider = yield* catalog.provider.get(providerID)
      expect(provider?.package).toBe(ProviderV2.aisdk("@ai-sdk/anthropic"))
      expect(provider?.headers).toEqual({ "X-Custom": "preserved" })
    }),
  )
})
