import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { TransportRequest } from "../src/schema"
import { Transport } from "../src/transport"
import { testEffect } from "./lib/effect"

const encoder = new TextEncoder()

const http = HttpClient.make((request) =>
  Effect.gen(function* () {
    const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)

    expect(web.method).toBe("POST")
    expect(web.headers.get("authorization")).toBe("Bearer test")
    expect(yield* Effect.promise(() => web.text())).toBe("hello")

    return HttpClientResponse.fromWeb(
      request,
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("ok"))
            controller.close()
          },
        }),
        { status: 202, headers: { "content-type": "text/plain" } },
      ),
    )
  }),
)

const it = testEffect(Transport.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http))))

describe("llm transport", () => {
  it.effect("executes TransportRequest through HttpClient", () =>
    Effect.gen(function* () {
      const transport = yield* Transport.Service
      const response = yield* transport.fetch(
        new TransportRequest({
          url: "https://fake.local/chat",
          method: "POST",
          headers: { authorization: "Bearer test", "content-type": "text/plain" },
          body: "hello",
        }),
      )

      expect(response.status).toBe(202)
      expect(response.headers["content-type"]).toBe("text/plain")
      expect(yield* response.text).toBe("ok")
    }),
  )
})
