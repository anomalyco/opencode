import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { XAIPlugin } from "@opencode-ai/core/plugin/provider/xai"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
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

  it.effect("marks xAI deployments as Responses WebSocket capable", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = Provider.ID.make("xai")
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/xai")
        })
        draft.model.update(providerID, Model.ID.make("grok-4.6"), () => {})
      })

      yield* addPlugin()

      expect((yield* catalog.model.get(providerID, Model.ID.make("grok-4.6")))?.capabilities.responsesWebsockets).toBe(
        true,
      )
    }),
  )
})
