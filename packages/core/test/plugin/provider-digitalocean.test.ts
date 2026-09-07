import { describe, expect, test } from "bun:test"
import { Clock, Effect, Schedule } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { Provider } from "@opencode-ai/core/provider"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { DigitalOceanPlugin } from "@opencode-ai/core/plugin/provider/digitalocean"
import { drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("digitalocean")
const integrationID = Integration.ID.make("digitalocean")
const methodID = Integration.MethodID.make("browser")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* DigitalOceanPlugin.effect(host)
})

const oauthCredential = Effect.fn(function* (access = "do-token", expires = 0) {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID,
    value: Credential.OAuth.make({ type: "oauth", methodID, access, refresh: "", expires }),
  })
})

const discovery = Effect.gen(function* () {
  const catalog = yield* Catalog.Service
  yield* catalog.transform((draft) => {
    draft.provider.update(providerID, (provider) => {
      provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
      provider.settings = { baseURL: "https://inference.do-ai.run/v1" }
    })
    draft.model.update(providerID, Model.ID.make("snapshot-model"), () => {})
    draft.model.update(providerID, Model.ID.make("router:configured"), (model) => {
      model.name = "Configured router"
      model.limit.context = 256_000
    })
    draft.model.update(Provider.ID.openai, Model.ID.make("router:alpha"), () => {})
  })
  const remote: { status: number; body: unknown; requests: HttpClientRequest.HttpClientRequest[] } = {
    status: 200,
    body: { model_routers: [{ name: "alpha" }, { name: "configured" }] },
    requests: [],
  }
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      remote.requests.push(request)
      return HttpClientResponse.fromWeb(request, Response.json(remote.body, { status: remote.status }))
    }),
  )
  return { catalog, remote, install: addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, http)) }
})

const status = Effect.fn(function* (attempt: Integration.Attempt) {
  const integrations = yield* Integration.Service
  return yield* integrations.oauth
    .status({ integrationID, attemptID: attempt.attemptID })
    .pipe(
      Effect.repeat({ until: (value) => value.status !== "pending", schedule: Schedule.spaced("10 millis") }),
      Effect.timeout("3 seconds"),
    )
})

describe("DigitalOceanPlugin", () => {
  test("is registered alongside the other provider plugins", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.digitalocean")
  })

  it.effect("registers browser OAuth alongside generic key and environment methods", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((draft) => {
        draft.method.update({ integrationID, method: { type: "key" } })
        draft.method.update({ integrationID, method: { type: "env", names: ["DIGITALOCEAN_ACCESS_TOKEN"] } })
      })
      yield* addPlugin()
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        { type: "key" },
        { type: "env", names: ["DIGITALOCEAN_ACCESS_TOKEN"] },
        { id: methodID, type: "oauth", label: "Login with DigitalOcean" },
      ])
    }),
  )

  it.effect("refreshes routers, retains the latest success on errors, and accepts an empty inventory", () =>
    Effect.gen(function* () {
      const fixture = yield* discovery
      yield* oauthCredential()
      yield* fixture.install
      yield* drain

      expect(fixture.remote.requests).toHaveLength(1)
      expect(fixture.remote.requests[0]).toMatchObject({
        method: "GET",
        url: "https://api.digitalocean.com/v2/gen-ai/models/routers",
        headers: { authorization: "Bearer do-token", accept: "application/json", "user-agent": expect.any(String) },
      })
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:alpha"))).toMatchObject({
        name: "alpha",
        family: "digitalocean-inference-routers",
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: "https://inference.do-ai.run/v1" },
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 128_000, output: 8_192 },
      })
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:configured"))).toMatchObject({
        name: "Configured router",
        limit: { context: 256_000 },
      })

      fixture.remote.body = { model_routers: [{ name: "beta" }] }
      yield* TestClock.adjust("4 minutes")
      yield* drain
      expect(fixture.remote.requests).toHaveLength(1)
      yield* TestClock.adjust("1 minute")
      yield* drain
      expect(fixture.remote.requests).toHaveLength(2)
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:alpha"))).toBeUndefined()
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeDefined()

      fixture.remote.status = 503
      yield* TestClock.adjust("5 minutes")
      yield* drain
      expect(fixture.remote.requests).toHaveLength(3)
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeDefined()

      fixture.remote.status = 200
      fixture.remote.body = { model_routers: [{ name: 123 }] }
      yield* TestClock.adjust("5 minutes")
      yield* drain
      expect(fixture.remote.requests).toHaveLength(4)
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeDefined()

      fixture.remote.body = { model_routers: [] }
      yield* TestClock.adjust("5 minutes")
      yield* drain
      expect(fixture.remote.requests).toHaveLength(5)
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeUndefined()
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("snapshot-model"))).toBeDefined()
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:configured"))).toBeDefined()
      expect(yield* fixture.catalog.model.get(Provider.ID.openai, Model.ID.make("router:alpha"))).toBeDefined()
    }),
  )

  it.effect("loads on credential changes and clears the previous account's routers", () =>
    Effect.gen(function* () {
      const fixture = yield* discovery
      const credentials = yield* Credential.Service
      yield* fixture.install
      yield* drain
      expect(fixture.remote.requests).toHaveLength(0)

      yield* oauthCredential()
      yield* drain
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:alpha"))).toBeDefined()

      fixture.remote.status = 503
      const second = yield* oauthCredential("other-account")
      yield* drain
      expect(fixture.remote.requests.at(-1)?.headers.authorization).toBe("Bearer other-account")
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:alpha"))).toBeUndefined()

      fixture.remote.status = 200
      fixture.remote.body = { model_routers: [{ name: "beta" }] }
      yield* TestClock.adjust("5 minutes")
      yield* drain
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeDefined()

      const count = fixture.remote.requests.length
      yield* credentials.create({ integrationID, value: Credential.Key.make({ type: "key", key: "do-key" }) })
      yield* drain
      expect(fixture.remote.requests).toHaveLength(count)
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeUndefined()

      yield* credentials.activate(second.id)
      yield* drain
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeDefined()
      yield* credentials.remove(second.id)
      yield* drain
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeUndefined()
    }),
  )

  it.effect("stops discovery when the token expires while retaining its last successful inventory", () =>
    Effect.gen(function* () {
      const fixture = yield* discovery
      yield* oauthCredential("do-token", (yield* Clock.currentTimeMillis) + 60_000)
      yield* fixture.install
      yield* drain
      expect(fixture.remote.requests).toHaveLength(1)
      yield* TestClock.adjust("5 minutes")
      yield* drain
      expect(fixture.remote.requests).toHaveLength(1)
      expect(yield* fixture.catalog.model.get(providerID, Model.ID.make("router:alpha"))).toBeDefined()
    }),
  )

  it.live("completes browser OAuth independently of router discovery and releases the listener", () =>
    Effect.gen(function* () {
      const fixture = yield* discovery
      fixture.remote.status = 503
      yield* fixture.install
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      const url = new URL(attempt.url)
      expect(attempt.mode).toBe("auto")
      expect(url.origin + url.pathname).toBe("https://cloud.digitalocean.com/v1/oauth/authorize")
      expect(url.searchParams.get("response_type")).toBe("token")
      expect(url.searchParams.get("client_id")).toBe("b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82")
      expect(url.searchParams.get("scope")).toBe("genai:read inference:query")
      expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1456/auth/callback")
      expect(url.searchParams.get("state")).toBeTruthy()
      const page = yield* Effect.promise(() =>
        fetch("http://localhost:1456/auth/callback", { headers: { Connection: "close" } }).then((res) => res.text()),
      )
      expect(page).toContain("/auth/token")
      const now = Date.now()
      const response = yield* Effect.promise(() =>
        fetch("http://localhost:1456/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "close" },
          body: JSON.stringify({ access_token: "do-token", expires_in: "3600", state: url.searchParams.get("state") }),
        }),
      )
      expect(response.status).toBe(200)
      expect(yield* status(attempt)).toMatchObject({ status: "complete" })
      const saved = (yield* credentials.list(integrationID))[0]?.value
      expect(saved).toMatchObject({ type: "oauth", methodID, access: "do-token", refresh: "" })
      expect(saved?.metadata).toBeUndefined()
      if (saved?.type !== "oauth") throw new Error("Expected OAuth credential")
      expect(saved.expires).toBeGreaterThanOrEqual(now + 3_600_000)
      expect(saved.expires).toBeLessThanOrEqual(Date.now() + 3_600_000)

      const next = yield* integrations.oauth.connect({ integrationID, methodID })
      expect(new URL(next.url).searchParams.get("state")).not.toBe(url.searchParams.get("state"))
      yield* integrations.oauth.cancel({ integrationID, attemptID: next.attemptID })
      const retry = yield* integrations.oauth.connect({ integrationID, methodID })
      yield* integrations.oauth.cancel({ integrationID, attemptID: retry.attemptID })
    }),
  )

  const invalid = [
    {
      name: "mismatched state",
      body: JSON.stringify({ access_token: "token", state: "wrong" }),
      message: "Invalid OAuth state",
    },
    { name: "missing token", body: JSON.stringify({}), message: "Missing access token" },
    { name: "malformed JSON", body: "not-json", message: "Missing access token" },
    {
      name: "provider denial",
      body: JSON.stringify({ error: "access_denied", error_description: "Denied" }),
      message: "Denied",
    },
    {
      name: "provider denial without a description",
      body: JSON.stringify({ error: "access_denied", error_description: "" }),
      message: "access_denied",
    },
  ]
  invalid.forEach((fixture) => {
    it.live(`rejects ${fixture.name} and releases the listener`, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const credentials = yield* Credential.Service
        const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
        const response = yield* Effect.promise(() =>
          fetch("http://localhost:1456/auth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json", Connection: "close" },
            body: fixture.body,
          }),
        )
        expect(response.status).toBe(400)
        expect(yield* status(attempt)).toMatchObject({ status: "failed", message: fixture.message })
        expect(yield* credentials.list(integrationID)).toEqual([])
        const next = yield* integrations.oauth.connect({ integrationID, methodID })
        yield* integrations.oauth.cancel({ integrationID, attemptID: next.attemptID })
      }),
    )
  })
})
