import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
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
  it.effect("registers device OAuth and API key methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const integration = yield* integrations.get(Integration.ID.make("xai"))
      expect(integration?.name).toBe("xAI")
      expect(integration?.methods).toEqual([
        {
          id: Integration.MethodID.make("device"),
          type: "oauth",
          label: "SuperGrok Subscription",
        },
        { type: "key", label: "Manually enter API Key" },
      ])
    }),
  )

  it.effect("migrates browser OAuth credentials to the device method", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const original = yield* credentials.create({
        integrationID: Integration.ID.make("xai"),
        label: "personal",
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("browser"),
          access: "access",
          refresh: "refresh",
          expires: 123,
          metadata: { account: "account" },
        }),
      })

      yield* addPlugin()

      expect(yield* credentials.get(original.id)).toEqual({
        ...original,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "access",
          refresh: "refresh",
          expires: 123,
          metadata: { account: "account" },
        }),
      })
    }),
  )
})
