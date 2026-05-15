import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { VercelPlugin } from "@opencode-ai/core/plugin/provider/vercel"
import { it, model, provider } from "./provider-helper"

describe("VercelPlugin", () => {
  it.effect("applies legacy lower-case referer headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(VercelPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("vercel", {
            options: { headers: { Existing: "1" }, body: {}, aisdk: { provider: {}, request: {} } },
          }),
          cancel: false,
        },
      )
      expect(result.provider.options.headers).toEqual({
        Existing: "1",
        "http-referer": "https://opencode.ai/",
        "x-title": "opencode",
      })
    }),
  )

  it.effect("does not add legacy upper-case referer headers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(VercelPlugin)
      const result = yield* plugin.trigger("provider.update", {}, { provider: provider("vercel"), cancel: false })
      expect(result.provider.options.headers).not.toHaveProperty("HTTP-Referer")
      expect(result.provider.options.headers).not.toHaveProperty("X-Title")
    }),
  )

  it.effect("creates @ai-sdk/vercel SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(VercelPlugin)
      const event = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("custom-vercel", "v0-1.0-md"), package: "@ai-sdk/vercel", options: { name: "custom-vercel" } },
        {},
      )
      expect(event.sdk).toBeDefined()
      expect(event.sdk.languageModel("v0-1.0-md").provider).toBe("vercel.chat")
    }),
  )

  it.effect("ignores non-Vercel providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(VercelPlugin)
      const result = yield* plugin.trigger("provider.update", {}, { provider: provider("gateway"), cancel: false })
      expect(result.provider.options.headers).toEqual({})
    }),
  )
})
