import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { existsSync } from "node:fs"
import { isHttpInteraction } from "../src/cassette/model"
import { HttpRecorder } from "../src"
import { failureText, post, readCassette, seedCassetteDirectory, tempDirectory, withEnvironment } from "./support"

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.layerFetch("http/multi-step"))))

const runWith = <A, E>(
  name: string,
  options: HttpRecorder.RecorderOptions,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.layerFetch(name, options))))

describe("HTTP", () => {
  test("decorates a provided HTTP client", async () => {
    await Effect.runPromise(
      Effect.all([post("https://example.test/echo", { step: 1 }), post("https://example.test/echo", { step: 2 })]).pipe(
        Effect.provide(HttpRecorder.layer("http/multi-step")),
        Effect.provide(FetchHttpClient.layer),
      ),
    )
  })

  test("replay returns recorded responses in order for identical requests", async () => {
    await runWith(
      "http/retry",
      {},
      Effect.gen(function* () {
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"complete"}')
      }),
    )
  })

  test("replay reports exhaustion when more requests are made than recorded", async () => {
    await run(
      Effect.gen(function* () {
        yield* post("https://example.test/echo", { step: 1 })
        yield* post("https://example.test/echo", { step: 2 })
        const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })

  test("a mismatch does not consume an interaction", async () => {
    await run(
      Effect.gen(function* () {
        yield* post("https://example.test/echo", { step: 1 })
        const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(failureText(exit)).toContain("$.step expected 2, received 3")
        expect(yield* post("https://example.test/echo", { step: 2 })).toBe('{"reply":"second"}')
      }),
    )
  })

  test("distinct requests replay in any order", async () => {
    await run(
      Effect.gen(function* () {
        expect(yield* post("https://example.test/echo", { step: 2 })).toBe('{"reply":"second"}')
        expect(yield* post("https://example.test/echo", { step: 1 })).toBe('{"reply":"first"}')
      }),
    )
  })

  test("concurrent distinct requests atomically claim their matching interactions", async () => {
    const results = await run(
      Effect.all([post("https://example.test/echo", { step: 2 }), post("https://example.test/echo", { step: 1 })], {
        concurrency: "unbounded",
      }),
    )

    expect(results).toEqual(['{"reply":"second"}', '{"reply":"first"}'])
  })

  test("concurrent replay claims each interaction once", async () => {
    const results = await runWith(
      "http/retry",
      {},
      Effect.all(
        [post("https://example.test/poll", { id: "job_1" }), post("https://example.test/poll", { id: "job_1" })],
        { concurrency: "unbounded" },
      ),
    )

    expect(results.toSorted()).toEqual(['{"status":"complete"}', '{"status":"pending"}'])
  })

  test("mismatch diagnostics show redacted request differences against the expected interaction", async () => {
    await run(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          post("https://example.test/echo?api_key=secret-value", {
            step: 3,
            token: "sk-123456789012345678901234",
          }),
        )
        const message = failureText(exit)
        expect(message).toContain("url:")
        expect(message).toContain("https://example.test/echo?api_key=%5BREDACTED%5D")
        expect(message).toContain("body:")
        expect(message).toContain("$.step expected 1, received 3")
        expect(message).toContain('$.token expected undefined, received "[REDACTED]"')
        expect(message).not.toContain("sk-123456789012345678901234")
      }),
    )
  })

  test("applies custom URL redaction to mismatch errors", async () => {
    const secret = "private-account"
    const exit = await Effect.runPromiseExit(
      post(`https://example.test/${secret}`, { step: 1 }).pipe(
        Effect.provide(
          HttpRecorder.layerFetch("http/multi-step", {
            redact: { url: (url) => url.replace(secret, "{account}") },
          }),
        ),
      ),
    )
    const message = failureText(exit)

    expect(message).toContain("https://example.test/{account}")
    expect(message).not.toContain(secret)
  })

  test("fails when a non-empty replay cassette is completely unused", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.void.pipe(Effect.scoped, Effect.provide(HttpRecorder.layerFetch("http/multi-step"))),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureText(exit)).toContain("Unused recorded interactions in http/multi-step: used 0 of 2")
  })

  test("allows an unused replay layer when the cassette is missing", async () => {
    using directory = tempDirectory("http-recorder-unused-missing-")
    await withEnvironment("CI", "true", () =>
      Effect.runPromise(
        Effect.void.pipe(
          Effect.scoped,
          Effect.provide(HttpRecorder.layerFetch("missing-cassette", { directory: directory.path })),
        ),
      ),
    )
  })

  describe("auto mode", () => {
    test("replays when the cassette exists", async () => {
      using directory = tempDirectory("http-recorder-auto-")
      await seedCassetteDirectory(directory.path, "auto-replay", [
        {
          transport: "http",
          request: {
            method: "POST",
            url: "https://example.test/echo",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ step: 1 }),
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: '{"reply":"hi"}',
          },
        },
      ])

      const result = await runWith(
        "auto-replay",
        { directory: directory.path },
        post("https://example.test/echo", { step: 1 }),
      )
      expect(result).toBe('{"reply":"hi"}')
    })

    test("forces replay when CI=true even if cassette is missing", async () => {
      using directory = tempDirectory("http-recorder-auto-ci-")
      await withEnvironment("CI", "true", async () => {
        const exit = await Effect.runPromise(
          Effect.exit(
            post("https://example.test/echo", { step: 1 }).pipe(
              Effect.provide(HttpRecorder.layerFetch("missing-cassette", { directory: directory.path })),
            ),
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(failureText(exit)).toContain('Fixture "missing-cassette" not found')
      })
    })

    test("records to disk when the cassette is missing", async () => {
      using directory = tempDirectory("http-recorder-auto-record-")
      using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response('{"reply":"recorded"}', {
            headers: { "content-type": "application/json" },
          }),
      })
      const url = `http://127.0.0.1:${server.port}/echo`
      await withEnvironment("CI", undefined, async () => {
        const result = await runWith("auto-record", { directory: directory.path }, post(url, { step: 1 }))
        expect(result).toBe('{"reply":"recorded"}')
        expect(existsSync(`${directory.path}/auto-record.json`)).toBe(true)
      })
    })

    test("records concurrent requests in request-start order", async () => {
      using directory = tempDirectory("http-recorder-order-")
      const first = Promise.withResolvers<void>()
      const completed: string[] = []
      using server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const name = new URL(request.url).pathname.slice(1)
          if (name === "first") {
            await first.promise
            completed.push(name)
            return new Response(name)
          }
          completed.push(name)
          first.resolve()
          return new Response(name)
        },
      })
      await withEnvironment("CI", undefined, async () => {
        const request = (name: string) =>
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const response = yield* http.execute(HttpClientRequest.get(`http://127.0.0.1:${server.port}/${name}`))
            return yield* response.text
          })
        const responses = await Effect.runPromise(
          Effect.all([request("first"), request("second")], {
            concurrency: "unbounded",
          }).pipe(Effect.provide(HttpRecorder.layerFetch("concurrent-order", { directory: directory.path }))),
        )
        const cassette = readCassette(`${directory.path}/concurrent-order.json`)

        expect(completed).toEqual(["second", "first"])
        expect(responses).toEqual(["first", "second"])
        expect(cassette.interactions.filter(isHttpInteraction).map((interaction) => interaction.request.url)).toEqual([
          `http://127.0.0.1:${server.port}/first`,
          `http://127.0.0.1:${server.port}/second`,
        ])
      })
    })

    test("returns the live response while persisting its redacted snapshot", async () => {
      using directory = tempDirectory("http-recorder-live-response-")
      using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(JSON.stringify({ access_token: "live-secret", safe: true }), {
            headers: {
              "content-type": "application/json",
              "x-request-id": "request-1",
            },
          }),
      })
      await withEnvironment("CI", undefined, async () => {
        const body = await runWith(
          "live-response",
          { directory: directory.path },
          post(`http://127.0.0.1:${server.port}/response`, { ok: true }),
        )
        const cassette = readCassette(`${directory.path}/live-response.json`)
        const interaction = cassette.interactions.find(isHttpInteraction)

        expect(body).toBe('{"access_token":"live-secret","safe":true}')
        expect(interaction?.response.body).toBe('{"access_token":"[REDACTED]","safe":true}')
      })
    })

    test("reconstructs responses with null-body statuses", async () => {
      using directory = tempDirectory("http-recorder-no-content-")
      using server = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 204 }),
      })
      await withEnvironment("CI", undefined, async () => {
        const program = Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          return yield* http.execute(HttpClientRequest.get(`http://127.0.0.1:${server.port}/empty`))
        })
        const response = await Effect.runPromise(
          program.pipe(Effect.provide(HttpRecorder.layerFetch("no-content", { directory: directory.path }))),
        )

        expect(response.status).toBe(204)
      })
    })

    test("records and replays arbitrary binary responses without changing bytes", async () => {
      using directory = tempDirectory("http-recorder-binary-")
      const expected = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x80])
      using server = Bun.serve({
        port: 0,
        fetch: () => new Response(expected, { headers: { "content-type": "image/png" } }),
      })
      const url = `http://127.0.0.1:${server.port}/image.png`
      await withEnvironment("CI", undefined, async () => {
        const program = Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          const response = yield* http.execute(HttpClientRequest.get(url))
          return new Uint8Array(yield* response.arrayBuffer)
        })
        const record = await Effect.runPromise(
          program.pipe(Effect.provide(HttpRecorder.layerFetch("binary", { directory: directory.path }))),
        )
        await server.stop()
        const replay = await Effect.runPromise(
          program.pipe(Effect.provide(HttpRecorder.layerFetch("binary", { directory: directory.path }))),
        )
        const cassette = readCassette(`${directory.path}/binary.json`)
        const interaction = cassette.interactions.find(isHttpInteraction)

        expect(record).toEqual(expected)
        expect(replay).toEqual(expected)
        expect(interaction?.response.bodyEncoding).toBe("base64")
      })
    })
  })
})
