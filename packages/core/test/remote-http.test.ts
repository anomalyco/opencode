import { describe, expect } from "bun:test"
import { Effect, Tracer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { RemoteHttp } from "@opencode/core/remote-http"
import { it } from "./lib/effect"

describe("RemoteHttp.get", () => {
  it.effect("redacts a source's headers on the request's trace span", () =>
    Effect.gen(function* () {
      const spans: Tracer.NativeSpan[] = []
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options)
          spans.push(span)
          return span
        },
      })
      const http = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response("ok"))))

      yield* RemoteHttp.get(http, "https://example.test/rules.md", { "X-Token": "secret", Accept: "text/plain" }).pipe(
        Effect.scoped,
        Effect.provideService(Tracer.Tracer, tracer),
        // Effect records no headers by default; a tracing setup that opts in must still never see these values.
        Effect.provideService(HttpClient.TracerHeaderFilter, () => true),
      )

      const attributes = Object.fromEntries(spans.flatMap((span) => Array.from(span.attributes)))
      expect(attributes["http.request.header.x-token"]).toBe("<redacted>")
      expect(attributes["http.request.header.accept"]).toBe("<redacted>")
    }),
  )
})
