import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { Provider } from "@opencode-ai/core/provider"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import {
  authorizeURL,
  DigitalOceanPlugin,
  routersFetchedAt,
  routersFromMetadata,
  routersFromResponse,
} from "@opencode-ai/core/plugin/provider/digitalocean"
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

const oauthCredential = (routers: string[], overrides?: { expires?: number; fetchedAt?: number }) =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    return yield* credentials.create({
      integrationID,
      value: Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "do-token",
        refresh: "",
        expires: overrides?.expires ?? Date.now() + 60 * 60 * 1000,
        metadata: {
          routers: JSON.stringify(routers),
          routersFetchedAt: overrides?.fetchedAt ?? Date.now(),
        },
      }),
    })
  })

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("DigitalOceanPlugin", () => {
  test("is registered alongside the other provider plugins", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.digitalocean")
  })

  test("builds an implicit-flow authorize URL", () => {
    const url = new URL(authorizeURL("http://localhost:1456/auth/callback", "state-value"))
    expect(url.origin + url.pathname).toBe("https://cloud.digitalocean.com/v1/oauth/authorize")
    expect(url.searchParams.get("response_type")).toBe("token")
    expect(url.searchParams.get("client_id")).toBe(
      "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82",
    )
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1456/auth/callback")
    expect(url.searchParams.get("scope")).toBe("genai:read inference:query")
    expect(url.searchParams.get("state")).toBe("state-value")
  })

  test("parses router payloads and credential metadata", () => {
    expect(routersFromResponse({ model_routers: [{ name: "alpha" }, { name: "beta" }] })).toEqual(["alpha", "beta"])
    expect(routersFromResponse({ model_routers: [] })).toEqual([])
    expect(routersFromResponse({})).toEqual([])
    expect(routersFromResponse(undefined)).toEqual([])
    expect(routersFromMetadata({ routers: JSON.stringify([{ name: "alpha" }]) })).toEqual(["alpha"])
    expect(routersFromMetadata({ routers: '["alpha",""]' })).toEqual(["alpha"])
    expect(routersFromMetadata({ routers: "not-json" })).toEqual([])
    expect(routersFromMetadata({})).toEqual([])
    expect(routersFromMetadata(undefined)).toEqual([])
    expect(routersFetchedAt({ routersFetchedAt: Date.now() })).toBeGreaterThan(0)
    expect(routersFetchedAt({})).toBe(0)
    expect(routersFetchedAt(undefined)).toBe(0)
  })

  it.effect("registers browser OAuth without removing the generic key method", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((draft) => {
        draft.method.update({ integrationID, method: { type: "key" } })
      })
      yield* addPlugin()
      const methods = (yield* integrations.get(integrationID))?.methods ?? []
      expect(methods).toContainEqual({
        id: methodID,
        type: "oauth",
        label: "Login with DigitalOcean",
      })
      expect(methods).toContainEqual({ type: "key" })
    }),
  )

  it.effect("backfills inference routers as models", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL: "https://inference.do-ai.run/v1" }
        })
      })
      yield* oauthCredential(["alpha", "beta"])
      yield* addPlugin()

      const alpha = required(yield* catalog.model.get(providerID, Model.ID.make("router:alpha")))
      expect(alpha.name).toBe("alpha")
      expect(alpha.family).toBe(Model.Family.make("digitalocean-inference-routers"))
      expect(alpha.capabilities).toMatchObject({ tools: true, input: ["text"], output: ["text"] })
      expect(alpha.limit).toMatchObject({ context: 128_000, output: 8_192 })
      expect(alpha.enabled).toBe(true)
      expect(yield* catalog.model.get(providerID, Model.ID.make("router:beta"))).toBeDefined()
    }),
  )

  it.effect("keeps cached routers when the token is expired", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
      })
      yield* oauthCredential(["cached"], { expires: Date.now() - 1000 })
      yield* addPlugin()
      expect(yield* catalog.model.get(providerID, Model.ID.make("router:cached"))).toBeDefined()
    }),
  )

  it.effect("adds no router models without a browser credential", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
        draft.model.update(providerID, Model.ID.make("snapshot-model"), () => {})
      })
      yield* addPlugin()
      expect(yield* catalog.model.get(providerID, Model.ID.make("snapshot-model"))).toBeDefined()
      expect(yield* catalog.model.get(providerID, Model.ID.make("router:alpha"))).toBeUndefined()
    }),
  )

  it.effect("ignores key credentials and leaves other providers alone", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const integrations = yield* Integration.Service
      const openai = Provider.ID.openai
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
        draft.provider.update(openai, () => {})
        draft.model.update(openai, Model.ID.make("gpt-5"), () => {})
      })
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "do-key" }),
      })
      yield* addPlugin()

      expect(yield* catalog.model.get(openai, Model.ID.make("gpt-5"))).toBeDefined()
      expect(yield* catalog.model.get(openai, Model.ID.make("router:gpt-5"))).toBeUndefined()
      expect(yield* catalog.model.get(providerID, Model.ID.make("router:gpt-5"))).toBeUndefined()
      expect((yield* integrations.get(Integration.ID.make("openai")))?.methods ?? []).toEqual([])
    }),
  )
})
