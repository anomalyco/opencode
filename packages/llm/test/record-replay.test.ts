import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { testEffect } from "./lib/effect"
import { layer as recordReplayLayer, sequentialMatcher } from "./record-replay"

const post = (url: string, body: object) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const request = HttpClientRequest.post(url, {
      headers: { "content-type": "application/json" },
      body: HttpBody.text(JSON.stringify(body), "application/json"),
    })
    const response = yield* http.execute(request)
    return yield* response.text
  })

describe("record-replay", () => {
  testEffect(recordReplayLayer("record-replay/multi-step")).effect(
    "default matcher dispatches multi-interaction cassettes by request shape",
    () =>
      Effect.gen(function* () {
        // Out-of-order requests still resolve to their matching recorded
        // interactions because the default matcher is structural.
        expect(yield* post("https://example.test/echo", { step: 2 })).toBe('{"reply":"second"}')
        expect(yield* post("https://example.test/echo", { step: 1 })).toBe('{"reply":"first"}')
      }),
  )

  testEffect(recordReplayLayer("record-replay/retry", { match: sequentialMatcher })).effect(
    "sequential matcher returns recorded responses in order for identical requests",
    () =>
      Effect.gen(function* () {
        // Both requests are byte-identical; the cursor advances so each call
        // gets its own recorded response.
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"complete"}')
      }),
  )

  testEffect(recordReplayLayer("record-replay/retry")).effect(
    "default matcher returns the first match for identical requests (find-first)",
    () =>
      Effect.gen(function* () {
        // With the default structural matcher, identical requests collapse to
        // the first recorded response — sequentialMatcher is required to walk
        // the cassette in order.
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
      }),
  )

  testEffect(recordReplayLayer("record-replay/multi-step", { match: sequentialMatcher })).effect(
    "sequential matcher reports cursor exhaustion when more requests are made than recorded",
    () =>
      Effect.gen(function* () {
        yield* post("https://example.test/echo", { step: 1 })
        yield* post("https://example.test/echo", { step: 2 })
        const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
        expect(Exit.isFailure(exit)).toBe(true)
      }),
  )
})
