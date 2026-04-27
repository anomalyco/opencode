import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpRecorder } from "../src"

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

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.cassetteLayer("record-replay/multi-step"))))

const runWith = <A, E>(name: string, options: HttpRecorder.RecordReplayOptions, effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.cassetteLayer(name, options))))

const failureText = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return ""
  return Cause.prettyErrors(exit.cause).join("\n")
}

describe("http-recorder", () => {
  test("redacts sensitive URL query parameters", () => {
    expect(
      HttpRecorder.redactUrl(
        "https://example.test/path?key=secret-google-key&api_key=secret-openai-key&safe=value&X-Amz-Signature=secret-signature",
      ),
    ).toBe(
      "https://example.test/path?key=%5BREDACTED%5D&api_key=%5BREDACTED%5D&safe=value&X-Amz-Signature=%5BREDACTED%5D",
    )
  })

  test("redacts sensitive headers when allow-listed", () => {
    expect(
      HttpRecorder.redactHeaders(
        {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          "x-custom-token": "custom-secret",
          "x-api-key": "secret-key",
          "x-goog-api-key": "secret-google-key",
        },
        ["authorization", "content-type", "x-api-key", "x-goog-api-key", "x-custom-token"],
        ["x-custom-token"],
      ),
    ).toEqual({
      authorization: "[REDACTED]",
      "content-type": "application/json",
      "x-api-key": "[REDACTED]",
      "x-custom-token": "[REDACTED]",
      "x-goog-api-key": "[REDACTED]",
    })
  })

  test("detects secret-looking values without returning the secret", () => {
    expect(
      HttpRecorder.cassetteSecretFindings({
        version: 1,
        interactions: [
          {
            request: {
              method: "POST",
              url: "https://example.test/path?key=sk-123456789012345678901234",
              headers: {},
              body: JSON.stringify({ nested: "AIzaSyDHibiBRvJZLsFnPYPoiTwxY4ztQ55yqCE" }),
            },
            response: {
              status: 200,
              headers: {},
              body: "Bearer abcdefghijklmnopqrstuvwxyz",
            },
          },
        ],
      }),
    ).toEqual([
      { path: "interactions[0].request.url", reason: "API key" },
      { path: "interactions[0].request.body", reason: "Google API key" },
      { path: "interactions[0].response.body", reason: "bearer token" },
    ])
  })

  test("detects secret-looking values inside metadata", () => {
    expect(
      HttpRecorder.cassetteSecretFindings({
        version: 1,
        metadata: { token: "sk-123456789012345678901234" },
        interactions: [],
      }),
    ).toEqual([{ path: "metadata.token", reason: "API key" }])
  })

  test("default matcher dispatches multi-interaction cassettes by request shape", async () => {
    await run(
      Effect.gen(function* () {
        expect(yield* post("https://example.test/echo", { step: 2 })).toBe('{"reply":"second"}')
        expect(yield* post("https://example.test/echo", { step: 1 })).toBe('{"reply":"first"}')
      }),
    )
  })

  test("sequential dispatch returns recorded responses in order for identical requests", async () => {
    await runWith(
      "record-replay/retry",
      { dispatch: "sequential" },
      Effect.gen(function* () {
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"complete"}')
      }),
    )
  })

  test("default matcher returns the first match for identical requests", async () => {
    await runWith(
      "record-replay/retry",
      {},
      Effect.gen(function* () {
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
      }),
    )
  })

  test("sequential dispatch reports cursor exhaustion when more requests are made than recorded", async () => {
    await runWith(
      "record-replay/multi-step",
      { dispatch: "sequential" },
      Effect.gen(function* () {
        yield* post("https://example.test/echo", { step: 1 })
        yield* post("https://example.test/echo", { step: 2 })
        const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })

  test("mismatch diagnostics show closest redacted request differences", async () => {
    await run(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          post("https://example.test/echo?api_key=secret-value", { step: 3, token: "sk-123456789012345678901234" }),
        )
        const message = failureText(exit)
        expect(message).toContain("closest interaction: #1")
        expect(message).toContain("url:")
        expect(message).toContain("https://example.test/echo?api_key=%5BREDACTED%5D")
        expect(message).toContain("body:")
        expect(message).toContain('$.step expected 1, received 3')
        expect(message).toContain('$.token expected undefined, received "[REDACTED]"')
        expect(message).not.toContain("sk-123456789012345678901234")
      }),
    )
  })
})
