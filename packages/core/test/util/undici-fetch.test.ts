import { describe, expect, test } from "bun:test"
import { UndiciFetch } from "@opencode/core/util/undici-fetch"
import { create } from "@opencode/core/util/undici-fetch.node"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

describe("UndiciFetch", () => {
  // Node's built-in fetch enforces undici's 300s headers/body timeouts and cannot take an
  // undici@8 Agent (UND_ERR_INVALID_ARG), so the Agent only works paired with undici's own fetch.
  test("keeps the runtime fetch under Bun, which has no such timeouts", () => {
    expect(create({ bun: "1.3.0" })).toBeUndefined()
  })

  test("replaces the runtime fetch under Node", () => {
    expect(create({})).toBeFunction()
  })

  test("sends HttpClient requests through the given fetch", async () => {
    const urls: string[] = []
    const send = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        urls.push(String(input))
        return new Response("ok")
      },
      { preconnect: fetch.preconnect },
    )
    const body = await Effect.runPromise(
      HttpClient.get("https://provider.test/v1/chat").pipe(
        Effect.flatMap((response) => response.text),
        Effect.provide(UndiciFetch.layer(() => send).pipe(Layer.provide(FetchHttpClient.layer))),
      ),
    )
    expect(body).toBe("ok")
    expect(urls).toEqual(["https://provider.test/v1/chat"])
  })

  test("leaves HttpClient on the runtime fetch when there is nothing to send through", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("direct") })
    try {
      const body = await Effect.runPromise(
        HttpClient.get(server.url.href).pipe(
          Effect.flatMap((response) => response.text),
          Effect.provide(UndiciFetch.layer(() => undefined).pipe(Layer.provide(FetchHttpClient.layer))),
        ),
      )
      expect(body).toBe("direct")
    } finally {
      await server.stop(true)
    }
  })

  test("leaves a client that does not use fetch in charge", async () => {
    const send = Object.assign(
      async () => {
        throw new Error("the replacement client must not call fetch")
      },
      { preconnect: fetch.preconnect },
    )
    const replacement = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response("replacement"))),
      ),
    )
    const body = await Effect.runPromise(
      HttpClient.get("https://provider.test/v1/chat").pipe(
        Effect.flatMap((response) => response.text),
        Effect.provide(UndiciFetch.layer(() => send).pipe(Layer.provide(replacement))),
      ),
    )
    expect(body).toBe("replacement")
  })
})
