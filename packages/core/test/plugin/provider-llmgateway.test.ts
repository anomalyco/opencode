import { describe, expect, test } from "bun:test"
import { Effect, Schedule } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { LLMGatewayPlugin } from "@opencode/core/plugin/provider/llmgateway"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* LLMGatewayPlugin.effect(host)
})

describe("LLMGatewayPlugin", () => {
  test("is registered so legacy referer headers can be applied", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.llmgateway")
  })

  it.effect("applies legacy referer headers only to enabled llmgateway", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        editor.update(Integration.ID.make("llmgateway"), () => {})
        editor.update(Integration.ID.make("openrouter"), () => {})
      })
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("llmgateway"), (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://api.llmgateway.io/v1" }
          provider.headers = { Existing: "value" }
        })
        catalog.update(Provider.ID.openrouter, () => {})
      })
      yield* addPlugin()
      expect((yield* catalog.get(Provider.ID.make("llmgateway")))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-Source": "opencode",
      })
      expect((yield* catalog.get(Provider.ID.openrouter))?.headers).toBeUndefined()
    }),
  )

  it.effect("does not apply legacy headers to a disabled llmgateway provider", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        editor.update(Integration.ID.make("llmgateway"), () => {})
      })
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("llmgateway"), (provider) => {
          provider.activation = "disabled"
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { baseURL: "https://api.llmgateway.io/v1" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.get(Provider.ID.make("llmgateway")))?.activation).toBe("disabled")
      expect((yield* catalog.get(Provider.ID.make("llmgateway")))?.headers).toBeUndefined()
    }),
  )

  it.effect("adds browser login to both LLM Gateway integrations", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        for (const id of ["llmgateway", "llmgateway-providers", "openrouter"].map((id) => Integration.ID.make(id))) {
          editor.update(id, () => {})
          editor.method.update({ integrationID: id, method: { type: "key" } })
        }
      })
      yield* addPlugin()
      for (const id of ["llmgateway", "llmgateway-providers"])
        expect((yield* integrations.get(Integration.ID.make(id)))?.methods as unknown).toEqual([
          { type: "key" },
          { id: "browser", type: "oauth", label: "Log in with browser" },
        ])
      expect((yield* integrations.get(Integration.ID.make("openrouter")))?.methods as unknown).toEqual([
        { type: "key" },
      ])
    }),
  )

  it.live("stores the key the dashboard hands back to the loopback server", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      yield* integrations.transform((editor) => {
        editor.update(Integration.ID.make("llmgateway"), (integration) => (integration.name = "DevPass (LLM Gateway)"))
        editor.update(Integration.ID.make("llmgateway-providers"), (integration) => (integration.name = "LLM Gateway"))
      })
      yield* addPlugin()
      const connect = (integrationID: Integration.ID) =>
        integrations.oauth
          .connect({ integrationID, methodID: Integration.MethodID.make("browser"), label: "Browser" })
          .pipe(Effect.map((attempt) => ({ attempt, url: new URL(attempt.url) })))

      const paygo = yield* connect(Integration.ID.make("llmgateway-providers"))
      expect(paygo.url.origin + paygo.url.pathname).toBe("https://llmgateway.io/connect/cli")
      expect(paygo.url.searchParams.get("org")).toBe("default")
      expect(paygo.url.searchParams.get("source")).toBe("opencode")

      const integrationID = Integration.ID.make("llmgateway")
      const first = yield* connect(integrationID)
      expect(first.url.searchParams.get("org")).toBe("devpass")
      const forged = new URL(first.url.searchParams.get("callback") ?? "")
      expect(forged.hostname).toBe("127.0.0.1")
      forged.searchParams.set("state", "wrong")
      forged.searchParams.set("key", "llmgtwy_forged")
      expect((yield* Effect.promise(() => fetch(forged, { headers: { Connection: "close" } }))).status).toBe(400)
      expect((yield* integrations.oauth.status({ integrationID, attemptID: first.attempt.attemptID })).status).toBe(
        "failed",
      )

      const retry = yield* connect(integrationID)
      const callback = new URL(retry.url.searchParams.get("callback") ?? "")
      callback.searchParams.set("state", retry.url.searchParams.get("state") ?? "")
      callback.searchParams.set("key", "llmgtwy_minted")
      expect((yield* Effect.promise(() => fetch(callback, { headers: { Connection: "close" } }))).status).toBe(200)
      const status = yield* integrations.oauth.status({ integrationID, attemptID: retry.attempt.attemptID }).pipe(
        Effect.repeat({
          until: (value) => value.status !== "pending",
          schedule: Schedule.spaced("1 millis"),
          times: 100,
        }),
      )
      expect(status.status).toBe("complete")
      expect((yield* credentials.list(integrationID)).find((item) => item.label === "Browser")?.value).toMatchObject({
        type: "oauth",
        access: "llmgtwy_minted",
        refresh: "",
      })
    }),
  )
})
