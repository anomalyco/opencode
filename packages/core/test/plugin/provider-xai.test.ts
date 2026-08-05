import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Integration } from "@opencode-ai/core/integration"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { XAIPlugin } from "@opencode-ai/core/plugin/provider/xai"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* XAIPlugin.effect(host)
})

describe("XAIPlugin", () => {
  it.effect("registers browser OAuth, device OAuth, and API key methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const integration = yield* integrations.get(Integration.ID.make("xai"))
      expect(integration?.name).toBe("xAI")
      expect(integration?.methods).toEqual([
        {
          id: Integration.MethodID.make("browser"),
          type: "oauth",
          label: "xAI Grok OAuth (SuperGrok Subscription)",
        },
        {
          id: Integration.MethodID.make("device"),
          type: "oauth",
          label: "xAI Grok OAuth (Headless / Remote / VPS)",
        },
        { type: "key", label: "Manually enter API Key" },
      ])
    }),
  )
})
