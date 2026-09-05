import { describe, expect } from "bun:test"
import { AIError } from "@opencode-ai/ai"
import type { RequestExecutor } from "@opencode-ai/ai/route"
import { Config } from "@opencode-ai/core/config"
import { Provider } from "@opencode-ai/core/provider"
import { ProviderOAuth } from "@opencode-ai/core/provider-oauth"
import { Document, Info } from "@opencode-ai/schema/config"
import { ConfigProvider } from "@opencode-ai/schema/config/provider"
import { Effect, Fiber, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.merge(Config.testLayer(), FetchHttpClient.layer))
const providerID = Provider.ID.make("corporate")
const credentials = {
  grantType: "client_credentials",
  clientId: "client :+é",
  clientSecret: "secret &+é",
} as const

const serve = Effect.fn(function* (fetch: (request: Request) => Response | Promise<Response>) {
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  )
  const http = yield* HttpClient.HttpClient
  return {
    tokenUrl: new URL("/token", server.url).href,
    call: (middleware: RequestExecutor.HttpMiddleware) =>
      middleware(
        HttpClientRequest.post(new URL("/chat", server.url).href).pipe(
          HttpClientRequest.bodyText('{"prompt":"hello"}', "application/json"),
          HttpClientRequest.setHeaders({ "x-tenant": "example", "x-api-key": "old-key" }),
        ),
        http.execute,
      ).pipe(Effect.flatMap((response) => response.text)),
  }
})

describe("ProviderOAuth", () => {
  for (const clientAuthMethod of ["client_secret_basic", "client_secret_post"] as const) {
    it.live(`exchanges ${clientAuthMethod} credentials and shares cached tokens`, () =>
      Effect.gen(function* () {
        const requests: Array<{ path: string; auth: string | null; body: string; type: string | null }> = []
        const server = yield* serve(async (request) => {
          const path = new URL(request.url).pathname
          requests.push({
            path,
            auth: request.headers.get("authorization"),
            body: await request.text(),
            type: request.headers.get("content-type"),
          })
          if (path === "/token") return Response.json({ access_token: "token", token_type: "Bearer", expires_in: 3600 })
          expect(request.headers.get("x-api-key")).toBeNull()
          expect(request.headers.get("x-tenant")).toBe("example")
          return new Response("ok")
        })
        const middleware = yield* ProviderOAuth.make(providerID, {
          ...credentials,
          tokenUrl: server.tokenUrl,
          clientAuthMethod,
          scope: "llm.invoke other",
          audience: "gateway",
          resource: "https://gateway.example.com",
        })
        expect(requests).toEqual([])
        expect(
          yield* Effect.all(
            Array.from({ length: 8 }, () => server.call(middleware)),
            { concurrency: 8 },
          ),
        ).toEqual(Array(8).fill("ok"))
        const tokens = requests.filter((request) => request.path === "/token")
        expect(tokens).toHaveLength(1)
        expect(tokens[0]?.type).toBe("application/x-www-form-urlencoded")
        expect(Object.fromEntries(new URLSearchParams(tokens[0]?.body))).toEqual({
          grant_type: "client_credentials",
          scope: "llm.invoke other",
          audience: "gateway",
          resource: "https://gateway.example.com",
          ...(clientAuthMethod === "client_secret_post"
            ? { client_id: credentials.clientId, client_secret: credentials.clientSecret }
            : {}),
        })
        expect(tokens[0]?.auth).toBe(
          clientAuthMethod === "client_secret_basic"
            ? `Basic ${btoa("client+%3A%2B%C3%A9:secret+%26%2B%C3%A9")}`
            : null,
        )
        expect(requests.filter((request) => request.path === "/chat")).toEqual(
          Array(8).fill({ path: "/chat", auth: "Bearer token", body: '{"prompt":"hello"}', type: "application/json" }),
        )
      }),
    )
  }

  for (const test of [
    { status: 401, challenge: "", retry: true },
    { status: 403, challenge: 'Bearer error="invalid_token"', retry: true },
    { status: 403, challenge: 'Bearer error="insufficient_scope"', retry: false },
    { status: 500, challenge: "", retry: false },
  ]) {
    it.live(`bounds retries for HTTP ${test.status} ${test.challenge}`, () =>
      Effect.gen(function* () {
        const tokens: string[] = []
        const calls: Array<{ auth: string | null; body: string }> = []
        const server = yield* serve(async (request) => {
          if (new URL(request.url).pathname === "/token") {
            tokens.push(`token-${tokens.length + 1}`)
            return Response.json({ access_token: tokens.at(-1), token_type: "bearer", expires_in: 3600 })
          }
          calls.push({ auth: request.headers.get("authorization"), body: await request.text() })
          return new Response("rejected", { status: test.status, headers: { "www-authenticate": test.challenge } })
        })
        const middleware = yield* ProviderOAuth.make(providerID, { ...credentials, tokenUrl: server.tokenUrl })
        expect(yield* server.call(middleware)).toBe("rejected")
        expect(tokens).toHaveLength(test.retry ? 2 : 1)
        expect(calls).toEqual(tokens.map((token) => ({ auth: `Bearer ${token}`, body: '{"prompt":"hello"}' })))
      }),
    )
  }

  it.live("shares renewal after concurrent rejections and returns the successful response", () =>
    Effect.gen(function* () {
      const tokens: string[] = []
      const server = yield* serve((request) => {
        if (new URL(request.url).pathname === "/token") {
          tokens.push(`token-${tokens.length + 1}`)
          return Response.json({ access_token: tokens.at(-1), token_type: "Bearer", expires_in: 3600 })
        }
        return request.headers.get("authorization") === "Bearer token-1"
          ? new Response("expired", { status: 401 })
          : new Response("ok")
      })
      const middleware = yield* ProviderOAuth.make(providerID, { ...credentials, tokenUrl: server.tokenUrl })
      expect(
        yield* Effect.all(
          Array.from({ length: 8 }, () => server.call(middleware)),
          { concurrency: 8 },
        ),
      ).toEqual(Array(8).fill("ok"))
      expect(tokens).toHaveLength(2)
    }),
  )

  it.live("renews expired tokens and does not cache tokens without expires_in", () =>
    Effect.gen(function* () {
      const tokens: string[] = []
      const server = yield* serve((request) => {
        if (new URL(request.url).pathname !== "/token") return new Response("ok")
        tokens.push("token")
        return Response.json({
          access_token: "token",
          token_type: "Bearer",
          ...(tokens.length === 1 ? { expires_in: 0.1 } : {}),
        })
      })
      const middleware = yield* ProviderOAuth.make(providerID, { ...credentials, tokenUrl: server.tokenUrl })
      yield* server.call(middleware)
      yield* Effect.sleep("150 millis")
      yield* server.call(middleware)
      yield* server.call(middleware)
      expect(tokens).toHaveLength(3)
    }),
  )

  for (const response of [
    { status: 400, body: '{"error":"invalid_client","secret":"do-not-leak"}' },
    { status: 200, body: "do-not-leak" },
    { status: 200, body: '{"access_token":"do-not-leak","token_type":"MAC"}' },
    { status: 200, body: '{"access_token":"","token_type":"Bearer"}' },
    { status: 200, body: '{"access_token":"do-not-leak","token_type":"Bearer","expires_in":-1}' },
  ]) {
    it.live(`rejects invalid token responses without exposing credentials: ${response.body}`, () =>
      Effect.gen(function* () {
        const paths: string[] = []
        const server = yield* serve((request) => {
          paths.push(new URL(request.url).pathname)
          return new Response(response.body, { status: response.status })
        })
        const middleware = yield* ProviderOAuth.make(providerID, { ...credentials, tokenUrl: server.tokenUrl })
        const error = yield* server.call(middleware).pipe(Effect.flip)
        expect(error).toBeInstanceOf(AIError)
        expect(error).toMatchObject({ reason: { _tag: "Authentication" } })
        expect(String(error)).not.toContain("do-not-leak")
        expect(JSON.stringify(error)).not.toContain(credentials.clientSecret)
        expect(paths).toEqual(["/token"])
      }),
    )
  }

  it.live("cancels token acquisition and allows the next request to acquire a token", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const tokens: string[] = []
      const server = yield* serve((request) => {
        if (new URL(request.url).pathname !== "/token") return new Response("ok")
        tokens.push("token")
        if (tokens.length === 1) {
          started.resolve()
          return new Promise<Response>(() => {})
        }
        return Response.json({ access_token: "token", token_type: "Bearer", expires_in: 3600 })
      })
      const middleware = yield* ProviderOAuth.make(providerID, { ...credentials, tokenUrl: server.tokenUrl })
      const pending = yield* server.call(middleware).pipe(Effect.forkScoped)
      yield* Effect.promise(() => started.promise)
      yield* Fiber.interrupt(pending)
      expect(yield* server.call(middleware)).toBe("ok")
      expect(tokens).toHaveLength(2)
    }),
  )

  it.live("isolates providers and replaces cached auth when configuration changes", () =>
    Effect.gen(function* () {
      const secrets: Array<string | null> = []
      const server = yield* serve(async (request) => {
        if (new URL(request.url).pathname !== "/token") return new Response("ok")
        secrets.push(new URLSearchParams(await request.text()).get("client_secret"))
        return Response.json({ access_token: `token-${secrets.length}`, token_type: "Bearer", expires_in: 3600 })
      })
      const config = yield* Config.Test
      const oauth = { ...credentials, tokenUrl: server.tokenUrl, clientAuthMethod: "client_secret_post" } as const
      const document = (providers: Info["providers"]) =>
        new Document({ type: "document", info: Info.make({ providers }) })
      yield* config.setEntries([document({ corporate: { oauth }, other: { oauth } })])
      const service = yield* ProviderOAuth.Service.pipe(Effect.provide(ProviderOAuth.layer))
      const first = yield* service.get(providerID)
      if (!first) throw new Error("Expected configured OAuth")
      yield* server.call(first)
      expect(yield* service.get(providerID)).toBe(first)
      const other = yield* service.get(Provider.ID.make("other"))
      if (!other) throw new Error("Expected second provider OAuth")
      yield* server.call(other)
      yield* config.setEntries([
        document({ corporate: { oauth } }),
        document({ corporate: { oauth: { ...oauth, clientSecret: "rotated" } } }),
      ])
      const updated = yield* service.get(providerID)
      if (!updated) throw new Error("Expected updated OAuth")
      expect(updated).not.toBe(first)
      yield* server.call(updated)
      yield* config.setEntries([])
      expect(yield* service.get(providerID)).toBeUndefined()
      expect(secrets).toEqual([credentials.clientSecret, credentials.clientSecret, "rotated"])
    }),
  )

  it.effect("validates the configuration and omits absent optional fields", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownSync(ConfigProvider.OAuth)
      const encode = Schema.encodeSync(ConfigProvider.OAuth)
      const oauth = { ...credentials, tokenUrl: "https://auth.example.com/token" }
      expect(encode(decode(oauth))).toEqual(oauth)
      expect(() => decode({ ...oauth, clientSecret: "" })).toThrow()
      expect(() => decode({ ...oauth, grantType: "authorization_code" })).toThrow()
      expect(() => decode({ ...oauth, clientAuthMethod: "none" })).toThrow()
    }),
  )
})
