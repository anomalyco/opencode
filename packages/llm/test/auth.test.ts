import { describe, expect } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { LLM } from "../src"
import { Auth } from "../src/route/auth"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { Model } from "../src/schema"
import { it } from "./lib/effect"

const request = LLM.request({
  id: "req_auth",
  model: Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route }),
  prompt: "hello",
})

const input = {
  request,
  method: "POST" as const,
  url: "https://example.test/v1/chat",
  body: "{}",
  headers: Headers.fromInput({ "x-existing": "yes" }),
}

const withEnv = (env: Record<string, string>) => Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))

describe("Auth", () => {
  it.effect("renders a config credential as bearer auth", () =>
    Effect.gen(function* () {
      const headers = yield* Auth.config("OPENAI_API_KEY")
        .bearer()
        .apply(input)
        .pipe(withEnv({ OPENAI_API_KEY: "sk-test" }))

      expect(headers.authorization).toBe("Bearer sk-test")
      expect(headers["x-existing"]).toBe("yes")
    }),
  )

  it.effect("falls back between credential sources before rendering", () =>
    Effect.gen(function* () {
      const headers = yield* Auth.config("PRIMARY_KEY")
        .orElse(Auth.value("fallback-key"))
        .pipe(Auth.header("x-api-key"))
        .apply(input)
        .pipe(withEnv({}))

      expect(headers["x-api-key"]).toBe("fallback-key")
      expect(headers["x-existing"]).toBe("yes")
    }),
  )

  it.effect("composes header auth in sequence", () =>
    Effect.gen(function* () {
      const headers = yield* Auth.headers({ "x-tenant-id": "tenant-1" })
        .andThen(Auth.bearer("gateway-token"))
        .apply(input)

      expect(headers["x-tenant-id"]).toBe("tenant-1")
      expect(headers.authorization).toBe("Bearer gateway-token")
      expect(headers["x-existing"]).toBe("yes")
    }),
  )

  it.effect("renders a direct secret as a custom header", () =>
    Effect.gen(function* () {
      const headers = yield* Auth.header("api-key", "direct-key").apply(input)

      expect(headers["api-key"]).toBe("direct-key")
      expect(headers["x-existing"]).toBe("yes")
    }),
  )

  it.effect("renders bearer auth into a custom header", () =>
    Effect.gen(function* () {
      const headers = yield* Auth.bearerHeader("cf-aig-authorization", "gateway-token").apply(input)

      expect(headers["cf-aig-authorization"]).toBe("Bearer gateway-token")
      expect(headers["x-existing"]).toBe("yes")
    }),
  )

  it.effect("falls back between full auth values", () =>
    Effect.gen(function* () {
      const headers = yield* Auth.config("OPENAI_API_KEY")
        .bearer()
        .orElse(Auth.headers({ authorization: "Bearer supplied" }))
        .apply(input)
        .pipe(withEnv({}))

      expect(headers.authorization).toBe("Bearer supplied")
      expect(headers["x-existing"]).toBe("yes")
    }),
  )

  it.effect("can intentionally leave auth untouched", () =>
    Effect.gen(function* () {
      const headers = yield* Auth.none.apply(input)

      expect(headers.authorization).toBeUndefined()
      expect(headers["x-existing"]).toBe("yes")
    }),
  )

  it.effect("pool credential rotates through keys", () =>
    Effect.gen(function* () {
      const cred = Auth.pool(["key-a", "key-b", "key-c"], "test-pool")
      const h1 = yield* cred.bearer().apply(input)
      const h2 = yield* cred.bearer().apply(input)
      const h3 = yield* cred.bearer().apply(input)
      const h4 = yield* cred.bearer().apply(input)

      expect(h1.authorization).toBe("Bearer key-a")
      expect(h2.authorization).toBe("Bearer key-b")
      expect(h3.authorization).toBe("Bearer key-c")
      expect(h4.authorization).toBe("Bearer key-a")
    }),
  )

  it.effect("pool credential with single key behaves like a regular credential", () =>
    Effect.gen(function* () {
      const cred = Auth.pool(["only-key"], "single")
      const h1 = yield* cred.bearer().apply(input)
      const h2 = yield* cred.bearer().apply(input)

      expect(h1.authorization).toBe("Bearer only-key")
      expect(h2.authorization).toBe("Bearer only-key")
    }),
  )

  it.effect("pool credential as custom header rotates correctly", () =>
    Effect.gen(function* () {
      const cred = Auth.pool(["k1", "k2"], "pool-header")
      const h1 = yield* cred.header("x-api-key").apply(input)
      const h2 = yield* cred.header("x-api-key").apply(input)

      expect(h1["x-api-key"]).toBe("k1")
      expect(h2["x-api-key"]).toBe("k2")
    }),
  )
})
