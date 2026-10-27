import { afterEach, describe, expect, test } from "bun:test"
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
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

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

  it.live("redeems the one-time code from the loopback with the PKCE verifier", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      yield* integrations.transform((editor) => {
        editor.update(Integration.ID.make("llmgateway"), (integration) => (integration.name = "DevPass (LLM Gateway)"))
        editor.update(Integration.ID.make("llmgateway-providers"), (integration) => (integration.name = "LLM Gateway"))
      })
      yield* addPlugin()
      const exchanges: { code: string; code_verifier: string }[] = []
      const tokenResponse = { status: 200, body: { api_key: "llmgtwy_minted", expires_at: "2099-01-01T00:00:00.000Z" } }
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) !== "https://internal.llmgateway.io/public/cli-auth/token") return realFetch(input, init)
        exchanges.push(JSON.parse(String(init?.body)))
        return Response.json(tokenResponse.body, { status: tokenResponse.status })
      }) as typeof fetch
      const connect = (integrationID: Integration.ID) =>
        integrations.oauth
          .connect({ integrationID, methodID: Integration.MethodID.make("browser"), label: "Browser" })
          .pipe(Effect.map((attempt) => ({ attempt, url: new URL(attempt.url) })))
      const callback = (url: URL, params: Record<string, string>) => {
        const target = new URL(url.searchParams.get("callback") ?? "")
        for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
        return Effect.promise(() => realFetch(target, { headers: { Connection: "close" } }))
      }
      const settled = (integrationID: Integration.ID, attemptID: Integration.AttemptID) =>
        integrations.oauth.status({ integrationID, attemptID }).pipe(
          Effect.repeat({
            until: (value) => value.status !== "pending",
            schedule: Schedule.spaced("1 millis"),
            times: 100,
          }),
        )

      const paygo = yield* connect(Integration.ID.make("llmgateway-providers"))
      expect(paygo.url.origin + paygo.url.pathname).toBe("https://llmgateway.io/connect/cli")
      expect(paygo.url.searchParams.get("org")).toBe("default")
      expect(paygo.url.searchParams.get("source")).toBe("opencode")
      expect(paygo.url.searchParams.get("code_challenge_method")).toBe("S256")

      const integrationID = Integration.ID.make("llmgateway")
      const forged = yield* connect(integrationID)
      expect(forged.url.searchParams.get("org")).toBe("devpass")
      expect(new URL(forged.url.searchParams.get("callback") ?? "").hostname).toBe("127.0.0.1")
      expect((yield* callback(forged.url, { state: "wrong", code: "forged" })).status).toBe(400)
      expect((yield* settled(integrationID, forged.attempt.attemptID)).status).toBe("failed")

      tokenResponse.status = 400
      tokenResponse.body = { error: "invalid_grant", error_description: "The login code is invalid" } as never
      const rejected = yield* connect(integrationID)
      expect(
        (yield* callback(rejected.url, { state: rejected.url.searchParams.get("state") ?? "", code: "stale" })).status,
      ).toBe(400)
      expect((yield* settled(integrationID, rejected.attempt.attemptID)).status).toBe("failed")

      tokenResponse.status = 200
      tokenResponse.body = { api_key: "llmgtwy_minted", expires_at: "2099-01-01T00:00:00.000Z" }
      const ok = yield* connect(integrationID)
      expect(
        (yield* callback(ok.url, { state: ok.url.searchParams.get("state") ?? "", code: "one-time" })).status,
      ).toBe(200)
      expect((yield* settled(integrationID, ok.attempt.attemptID)).status).toBe("complete")
      const exchange = exchanges.at(-1)
      expect(exchange?.code).toBe("one-time")
      const challenge = new Bun.CryptoHasher("sha256").update(exchange?.code_verifier ?? "").digest("base64url")
      expect(challenge).toBe(ok.url.searchParams.get("code_challenge") ?? "")
      expect((yield* credentials.list(integrationID)).find((item) => item.label === "Browser")?.value).toMatchObject({
        type: "oauth",
        access: "llmgtwy_minted",
        refresh: "",
        expires: Date.parse("2099-01-01T00:00:00.000Z"),
      })
    }),
  )
})
