import { describe, expect } from "bun:test"
import { gunzipSync, gzipSync, zstdDecompressSync } from "node:zlib"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { FetchHttpClient, HttpClientRequest } from "effect/http"
import { LLM, type RequestEncoding } from "../src/effect.js"
import { LLMClient } from "../src/route.js"
import { configure } from "../src/providers/openai.js"
import { dynamicResponse, runtimeLayer } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"
import { it, testEffect } from "./lib/effect.js"

const model = configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).chat("gpt-4.1-mini")

const send = (prompt: string, encoding?: RequestEncoding) =>
  Effect.gen(function* () {
    const seen: { encoding: string | null; body: Uint8Array }[] = []
    const server = dynamicResponse((input) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
        seen.push({
          encoding: web.headers.get("content-encoding"),
          body: new Uint8Array(yield* Effect.promise(() => web.arrayBuffer())),
        })
        return input.respond(sseEvents(deltaChunk({ role: "assistant", content: "Hi" }), finishChunk("stop")), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    )
    yield* LLMClient.generate(LLM.request({ model, prompt, http: encoding ? { encoding } : undefined })).pipe(
      Effect.provide(server),
    )
    return seen[0]
  })

describe("HTTP request encoding", () => {
  it.effect("compresses the JSON body with the requested encoding", () =>
    Effect.gen(function* () {
      const zstd = yield* send("Hello", "zstd")
      expect(zstd.encoding).toBe("zstd")
      expect(JSON.parse(zstdDecompressSync(zstd.body).toString())).toMatchObject({ model: "gpt-4.1-mini" })

      const gzip = yield* send("Hello", "gzip")
      expect(gzip.encoding).toBe("gzip")
      expect(JSON.parse(gunzipSync(gzip.body).toString())).toMatchObject({ model: "gpt-4.1-mini" })
    }),
  )

  it.effect("sends plain JSON when unset or none", () =>
    Effect.gen(function* () {
      for (const sent of [yield* send("Hello"), yield* send("Hello", "none")]) {
        expect(sent.encoding).toBeNull()
        expect(JSON.parse(new TextDecoder().decode(sent.body))).toMatchObject({ model: "gpt-4.1-mini" })
      }
    }),
  )
})

type Round = {
  accept?: string
  status?: number
  encoding?: RequestEncoding
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
  prompt?: string
  age?: number
}

const prompt = "a growing model conversation ".repeat(200)
const rounds = (steps: Round[]) =>
  Effect.gen(function* () {
    const seen: { encoding: string | null; body: Uint8Array; headers: Headers }[] = []
    const server = dynamicResponse((input) =>
      Effect.gen(function* () {
        const step = steps[seen.length]
        const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
        seen.push({
          encoding: web.headers.get("content-encoding"),
          body: new Uint8Array(yield* Effect.promise(() => web.arrayBuffer())),
          headers: web.headers,
        })
        return input.respond(sseEvents(deltaChunk({ role: "assistant", content: "Hi" }), finishChunk("stop")), {
          status: step.status ?? 200,
          headers: {
            "content-type": "text/event-stream",
            ...(step.accept === undefined ? {} : { "accept-encoding": step.accept }),
          },
        })
      }),
    )
    const results = yield* Effect.gen(function* () {
      return yield* Effect.forEach(steps, (step) =>
        Effect.gen(function* () {
          if (step.age) yield* TestClock.adjust(step.age)
          return yield* LLMClient.generate(
            LLM.request({
              model: configure({
                baseURL: step.baseURL ?? "https://api.openai.test/v1/",
                apiKey: step.apiKey ?? "test",
              }).chat("gpt-4.1-mini"),
              prompt: step.prompt ?? prompt,
              http:
                step.encoding === undefined && step.headers === undefined
                  ? undefined
                  : { encoding: step.encoding, headers: step.headers },
            }),
          ).pipe(Effect.result)
        }),
      )
    }).pipe(Effect.provide(server))
    return { seen, results }
  })

describe("negotiated HTTP request encoding", () => {
  it.effect("negotiates by default and preserves JSON and response preferences", () =>
    Effect.gen(function* () {
      const { seen, results } = yield* rounds(
        ([undefined, "auto", undefined] as const).map((encoding) => ({
          encoding,
          accept: "gzip, br",
          headers: { "accept-encoding": "br", "x-session-affinity": "session" },
        })),
      )
      expect(seen.map((call) => call.encoding)).toEqual([null, "gzip", "gzip"])
      expect(results.map((result) => result._tag)).toEqual(["Success", "Success", "Success"])
      for (const call of seen.slice(1)) {
        expect(gunzipSync(call.body)).toEqual(Buffer.from(seen[0].body))
        expect(call.body.length).toBeLessThan(seen[0].body.length)
        expect(call.headers.get("content-length")).toBe(String(call.body.length))
        expect(call.headers.get("accept-encoding")).toBe("br")
        expect(call.headers.get("x-session-affinity")).toBe("session")
      }
    }),
  )

  for (const [accept, encoding] of [
    ["zstd, gzip", "zstd"],
    ["gzip;q=0.9, zstd;q=0.1", "gzip"],
    ["gzip;q=0, zstd;q=0", null],
    ["gzip;q=0.5, identity;q=1", null],
    ["gzip;q=invalid", null],
    ["br", null],
  ] as const)
    it.effect(`honors explicit support and quality in ${String(accept)}`, () =>
      Effect.gen(function* () {
        const { seen } = yield* rounds([{ encoding: "auto", accept }, { encoding: "auto" }])
        expect(seen.map((call) => call.encoding)).toEqual([null, encoding])
        if (encoding === "zstd") expect(zstdDecompressSync(seen[1].body)).toEqual(Buffer.from(seen[0].body))
      }),
    )

  it.effect("does not treat client Accept-Encoding as server support", () =>
    Effect.gen(function* () {
      const { seen } = yield* rounds([
        { encoding: "auto", headers: { "accept-encoding": "gzip, zstd" } },
        { encoding: "auto", headers: { "accept-encoding": "gzip, zstd" } },
      ])
      expect(seen.map((call) => call.encoding)).toEqual([null, null])
    }),
  )

  it.effect("scopes advertisements to the URL, credentials and request headers", () =>
    Effect.gen(function* () {
      const { seen } = yield* rounds([
        { encoding: "auto", accept: "gzip" },
        { encoding: "auto", baseURL: "https://other.test/v1/" },
        { encoding: "auto", baseURL: "https://api.openai.test/v2/" },
        { encoding: "auto", apiKey: "another-account" },
        { encoding: "auto", headers: { "x-tenant": "another-tenant" } },
        { encoding: "auto" },
      ])
      expect(seen.map((call) => call.encoding)).toEqual([null, null, null, null, null, "gzip"])
    }),
  )

  it.effect("preserves explicit settings, small bodies and already encoded requests", () =>
    Effect.gen(function* () {
      const { seen } = yield* rounds([
        { encoding: "auto", accept: "gzip" },
        { encoding: "none" },
        {},
        { encoding: "zstd" },
        { encoding: "auto", prompt: "small" },
        { encoding: "auto", headers: { "content-encoding": "identity" } },
        { encoding: "auto" },
      ])
      expect(seen.map((call) => call.encoding)).toEqual([null, null, "gzip", "zstd", null, "identity", "gzip"])
    }),
  )

  it.effect("expires advertisements and honors withdrawals", () =>
    Effect.gen(function* () {
      const { seen } = yield* rounds([
        { encoding: "auto", accept: "gzip" },
        { encoding: "auto", age: 300_001, accept: "gzip" },
        { encoding: "auto", accept: "identity" },
        { encoding: "auto" },
      ])
      expect(seen.map((call) => call.encoding)).toEqual([null, null, "gzip", null])
    }),
  )

  for (const status of [400, 415])
    it.effect(`clears support on HTTP ${status} without retrying the generation`, () =>
      Effect.gen(function* () {
        const { seen, results } = yield* rounds([
          { encoding: "auto", accept: "gzip" },
          { status, accept: "gzip" },
          { encoding: "auto" },
        ])
        expect(seen.map((call) => call.encoding)).toEqual([null, "gzip", null])
        expect(results.map((result) => result._tag)).toEqual(["Success", "Failure", "Success"])
      }),
    )

  it.effect("does not learn from errors or redirects", () =>
    Effect.gen(function* () {
      const { seen } = yield* rounds([
        { encoding: "auto", status: 401, accept: "gzip" },
        { encoding: "auto", status: 307, accept: "gzip" },
        { encoding: "auto" },
      ])
      expect(seen.map((call) => call.encoding)).toEqual([null, null, null])
    }),
  )

  it.effect("does not alter signed request bodies", () =>
    Effect.gen(function* () {
      const headers = { "content-digest": "sha-256=:fixture:" }
      const { seen } = yield* rounds([
        { encoding: "auto", accept: "gzip", headers },
        { encoding: "auto", headers },
      ])
      expect(seen.map((call) => call.encoding)).toEqual([null, null])
    }),
  )
})

testEffect(runtimeLayer(FetchHttpClient.layer)).live(
  "negotiates by default over HTTP and follows redirects with destination-specific support",
  () =>
    Effect.gen(function* () {
      const seen: { path: string; encoding: string | null; bytes: number; json: unknown }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(request) {
              const bytes = new Uint8Array(await request.arrayBuffer())
              const encoding = request.headers.get("content-encoding")
              const path = new URL(request.url).pathname
              seen.push({
                path,
                encoding,
                bytes: bytes.length,
                json: JSON.parse(new TextDecoder().decode(encoding === "gzip" ? gunzipSync(bytes) : bytes)),
              })
              if (path === "/v1/chat/completions" && seen.length >= 4)
                return new Response(null, { status: 308, headers: { location: "/other" } })
              if (path === "/redirect/chat/completions")
                return new Response(null, { status: 308, headers: { location: "/canonical" } })
              return new Response(
                gzipSync(sseEvents(deltaChunk({ role: "assistant", content: "Hi" }), finishChunk("stop"))),
                {
                  headers: {
                    "content-type": "text/event-stream",
                    "content-encoding": "gzip",
                    "accept-encoding": "gzip, br",
                  },
                },
              )
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const model = configure({ baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "fixture" }).chat("fixture")
      for (const turn of [1, 2, 3]) {
        const response = yield* LLMClient.generate(LLM.request({ model, prompt: prompt.repeat(100) + turn }))
        expect(response.text).toBe("Hi")
      }
      expect(seen.map((call) => call.encoding)).toEqual([null, "gzip", "gzip"])
      expect(seen[1].bytes).toBeLessThan(seen[0].bytes)
      expect(seen[2].json).toMatchObject({ messages: [{ role: "user", content: prompt.repeat(100) + "3" }] })
      expect((yield* LLMClient.generate(LLM.request({ model, prompt }))).text).toBe("Hi")
      expect(seen.slice(3).map((call) => [call.path, call.encoding])).toEqual([
        ["/v1/chat/completions", "gzip"],
        ["/other", null],
      ])
      const redirected = configure({ baseURL: `http://127.0.0.1:${server.port}/redirect`, apiKey: "fixture" }).chat(
        "fixture",
      )
      for (const encoding of [undefined, "auto"] as const)
        expect((yield* LLMClient.generate(LLM.request({ model: redirected, prompt, http: { encoding } }))).text).toBe(
          "Hi",
        )
      expect(seen.slice(5).map((call) => [call.path, call.encoding])).toEqual([
        ["/redirect/chat/completions", null],
        ["/canonical", null],
        ["/redirect/chat/completions", null],
        ["/canonical", "gzip"],
      ])
    }),
)
