import { AISDK } from "@opencode-ai/core/aisdk"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import {
  accessTokenExp,
  buildAuthorizeURL,
  credentialExpires,
  oauthMethods,
  positiveSecondsToMs,
  XAIPlugin,
} from "@opencode-ai/core/plugin/provider/xai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  const integrations = yield* Integration.Service
  yield* XAIPlugin.effect(host).pipe(Effect.provideService(Integration.Service, integrations))
})

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

function makeJwt(payload: object) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("XAIPlugin", () => {
  it.effect("registers browser and headless SuperGrok OAuth methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("xai")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("browser"),
          type: "oauth",
          label: "xAI Grok OAuth (SuperGrok Subscription)",
        },
        {
          id: Integration.MethodID.make("headless"),
          type: "oauth",
          label: "xAI Grok OAuth (Headless / Remote / VPS)",
        },
      ])
    }),
  )

  it.effect("creates an xAI SDK only for @ai-sdk/xai", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const ignored = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        package: "@ai-sdk/openai-compatible",
        options: {},
      })

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        package: "@ai-sdk/xai",
        options: {},
      })

      expect(ignored.sdk).toBeUndefined()
      expect(typeof result.sdk?.responses).toBe("function")
    }),
  )

  it.effect("creates xAI SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-xai"), ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        package: "@ai-sdk/xai",
        options: {},
      })

      expect(result.sdk.responses("grok-4").provider).toBe("xai.responses")
    }),
  )

  it.effect("uses responses with the model modelID for xAI language models", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []

      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("xai"), ModelV2.ID.make("alias")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })

      expect(calls).toEqual(["responses:grok-4"])
      expect(result.language).toBeDefined()
    }),
  )

  it.effect("ignores non-xAI providers", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []

      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("grok-4")),
          modelID: ModelV2.ID.make("grok-4"),
          package: "aisdk:@ai-sdk/xai",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })

      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})

describe("xAI OAuth helpers", () => {
  it.effect("builds the SuperGrok authorize URL with Grok-CLI client params", () =>
    Effect.sync(() => {
      const url = new URL(
        buildAuthorizeURL({ verifier: "verifier", challenge: "challenge" }, "state-value", "nonce-value"),
      )
      expect(url.origin + url.pathname).toBe("https://auth.x.ai/oauth2/authorize")
      expect(url.searchParams.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828")
      expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:56121/callback")
      expect(url.searchParams.get("scope")).toBe("openid profile email offline_access grok-cli:access api:access")
      expect(url.searchParams.get("code_challenge")).toBe("challenge")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("state")).toBe("state-value")
      expect(url.searchParams.get("nonce")).toBe("nonce-value")
      expect(url.searchParams.get("plan")).toBe("generic")
      expect(url.searchParams.get("referrer")).toBe("opencode")
      expect(url.searchParams.get("response_type")).toBe("code")
    }),
  )

  it.effect("normalizes device interval seconds to milliseconds", () =>
    Effect.sync(() => {
      expect(positiveSecondsToMs(5, 1000)).toBe(5000)
      expect(positiveSecondsToMs("10", 1000)).toBe(10000)
      expect(positiveSecondsToMs(0, 1000)).toBe(1000)
      expect(positiveSecondsToMs(-1, 1000)).toBe(1000)
      expect(positiveSecondsToMs(Number.NaN, 1000)).toBe(1000)
      expect(positiveSecondsToMs(undefined, 1000)).toBe(1000)
      expect(positiveSecondsToMs(null, 1000)).toBe(1000)
    }),
  )

  it.effect("parses JWT exp for scheduling and ignores opaque tokens", () =>
    Effect.sync(() => {
      const exp = Math.floor(Date.now() / 1000) + 600
      expect(accessTokenExp(makeJwt({ exp }))).toBe(exp)
      expect(accessTokenExp("opaque-token")).toBeUndefined()
      expect(accessTokenExp(undefined)).toBeUndefined()
      expect(accessTokenExp(makeJwt({ sub: "user" }))).toBeUndefined()
    }),
  )

  it.effect("derives credentialExpires from expires_in, JWT exp, or default", () =>
    Effect.sync(() => {
      const now = 1_700_000_000_000
      const skew = 120_000
      expect(credentialExpires("opaque", 3600, now, skew)).toBe(now + 3600 * 1000 - skew)

      const exp = Math.floor(now / 1000) + 900
      expect(credentialExpires(makeJwt({ exp }), undefined, now, skew)).toBe(exp * 1000 - skew)

      // Positive expires_in wins over JWT exp.
      expect(credentialExpires(makeJwt({ exp }), 60, now, skew)).toBe(now + 60_000 - skew)

      // Opaque + no expires_in falls back to 1h.
      expect(credentialExpires("opaque", undefined, now, skew)).toBe(now + 3600 * 1000 - skew)

      // String expires_in is coerced.
      expect(credentialExpires("opaque", "120", now, skew)).toBe(now + 120_000 - skew)
    }),
  )
})

describe("xAI OAuth refresh + device flow", () => {
  it.live("refresh reuses the previous refresh_token when the response omits it", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const bodies: string[] = []
        const server = Bun.serve({
          port: 0,
          fetch: async (request) => {
            bodies.push(await request.text())
            return Response.json({ access_token: "new-access", expires_in: 3600 })
          },
        })
        return { bodies, server }
      }),
      ({ bodies, server }) =>
        Effect.gen(function* () {
          const methods = oauthMethods({ tokenURL: new URL("/oauth2/token", server.url).toString() })
          const refreshed = yield* methods.browser.refresh!({
            type: "oauth",
            methodID: Integration.MethodID.make("browser"),
            access: "old-access",
            refresh: "rt-old",
            expires: Date.now() - 1,
          })
          expect(refreshed.access).toBe("new-access")
          expect(refreshed.refresh).toBe("rt-old")
          expect(bodies[0]).toContain("refresh_token=rt-old")
          expect(refreshed.expires).toBeGreaterThan(Date.now())
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("refresh persists a rotated refresh_token when present", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () => Response.json({ access_token: "new-access", refresh_token: "rt-new", expires_in: 3600 }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const methods = oauthMethods({ tokenURL: new URL("/oauth2/token", server.url).toString() })
          const refreshed = yield* methods.headless.refresh!({
            type: "oauth",
            methodID: Integration.MethodID.make("headless"),
            access: "old-access",
            refresh: "rt-old",
            expires: Date.now() - 1,
          })
          expect(refreshed.access).toBe("new-access")
          expect(refreshed.refresh).toBe("rt-new")
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("refresh derives expires from JWT exp when expires_in is absent", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const exp = Math.floor(Date.now() / 1000) + 900
        const access = makeJwt({ exp })
        return {
          access,
          exp,
          server: Bun.serve({
            port: 0,
            fetch: () => Response.json({ access_token: access, refresh_token: "rt-new" }),
          }),
        }
      }),
      ({ access, exp, server }) =>
        Effect.gen(function* () {
          const methods = oauthMethods({ tokenURL: new URL("/oauth2/token", server.url).toString() })
          const refreshed = yield* methods.browser.refresh!({
            type: "oauth",
            methodID: Integration.MethodID.make("browser"),
            access: "old",
            refresh: "rt-old",
            expires: Date.now() - 1,
          })
          expect(refreshed.access).toBe(access)
          // 120s skew applied against JWT exp.
          expect(refreshed.expires).toBe(exp * 1000 - 120_000)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("device-code flow completes after authorization_pending and slow_down", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        let tokenHits = 0
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            const url = new URL(request.url)
            if (url.pathname.endsWith("/device/code")) {
              return Response.json({
                device_code: "DC",
                user_code: "UC-1",
                verification_uri: "https://accounts.x.ai/device",
                verification_uri_complete: "https://accounts.x.ai/device?user_code=UC-1",
                // String interval must still be accepted (positiveSecondsToMs).
                interval: "0.001",
                expires_in: "600",
              })
            }
            if (url.pathname.endsWith("/token")) {
              tokenHits += 1
              if (tokenHits === 1) return Response.json({ error: "authorization_pending" }, { status: 400 })
              if (tokenHits === 2) return Response.json({ error: "slow_down", interval: 0.001 }, { status: 400 })
              return Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })
            }
            return new Response("not found", { status: 404 })
          },
        })
        return { server, tokenHits: () => tokenHits }
      }),
      ({ server, tokenHits }) =>
        Effect.gen(function* () {
          const methods = oauthMethods({
            deviceAuthorizationURL: new URL("/oauth2/device/code", server.url).toString(),
            tokenURL: new URL("/oauth2/token", server.url).toString(),
            // Collapse RFC backoff waits so the pending/slow_down branches stay unit-testable.
            deviceMinIntervalMs: 0,
            pollingSafetyMarginMs: 0,
            deviceSlowDownIncrementMs: 0,
          })
          const authorization = yield* Effect.scoped(methods.headless.authorize({}))
          expect(authorization.url).toBe("https://accounts.x.ai/device?user_code=UC-1")
          expect(authorization.instructions).toContain("UC-1")
          const credential = yield* authorization.callback
          expect(credential.access).toBe("AT")
          expect(credential.refresh).toBe("RT")
          expect(tokenHits()).toBe(3)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("device-code flow fails on access_denied", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            const url = new URL(request.url)
            if (url.pathname.endsWith("/device/code")) {
              return Response.json({
                device_code: "DC",
                user_code: "UC",
                verification_uri: "https://accounts.x.ai/device",
                interval: 0,
                expires_in: 60,
              })
            }
            return Response.json({ error: "access_denied" }, { status: 400 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const methods = oauthMethods({
            deviceAuthorizationURL: new URL("/oauth2/device/code", server.url).toString(),
            tokenURL: new URL("/oauth2/token", server.url).toString(),
          })
          const authorization = yield* Effect.scoped(methods.headless.authorize({}))
          const error = yield* authorization.callback.pipe(Effect.flip)
          expect(String(error)).toContain("denied")
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("integration connection resolves a headless SuperGrok login against a mock server", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            const url = new URL(request.url)
            if (url.pathname.endsWith("/device/code")) {
              return Response.json({
                device_code: "DC",
                user_code: "UC",
                verification_uri: "https://accounts.x.ai/device",
                interval: 0,
                expires_in: 60,
              })
            }
            return Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const methods = oauthMethods({
            deviceAuthorizationURL: new URL("/oauth2/device/code", server.url).toString(),
            tokenURL: new URL("/oauth2/token", server.url).toString(),
          })
          yield* integrations.transform((draft) => {
            draft.method.update(methods.headless)
          })
          const attempt = yield* integrations.connection.oauth({
            integrationID: Integration.ID.make("xai"),
            methodID: Integration.MethodID.make("headless"),
            inputs: {},
          })
          yield* eventually(integrations.attempt.status(attempt.attemptID), (status) => status.status === "complete")
          const connection = yield* integrations.connection.active(Integration.ID.make("xai"))
          expect(connection?.type).toBe("credential")
          const credential = yield* integrations.connection.resolve(connection!)
          expect(credential).toMatchObject({ type: "oauth", access: "AT", refresh: "RT" })
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )
})
