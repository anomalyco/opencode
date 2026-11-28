import { describe, expect } from "bun:test"
import { gunzipSync, zstdDecompressSync } from "node:zlib"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { ai, type RequestEncoding } from "../src/effect.js"
import { LLMClient } from "../src/route.js"
import { configure } from "../src/providers/openai.js"
import { Anthropic } from "../src/providers.js"
import { LanguageModel } from "../src/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"
import { it } from "./lib/effect.js"

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
    yield* LLMClient.generate(ai.request({ model, prompt, http: encoding ? { encoding } : undefined })).pipe(
      Effect.provide(server),
    )
    return seen[0]
  })

// The first request a model sends, as the server receives it. The response doesn't matter.
const sent = (model: LanguageModel) =>
  Effect.gen(function* () {
    const seen: { url: string; encoding: string | null }[] = []
    const server = dynamicResponse((input) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
        seen.push({ url: web.url, encoding: web.headers.get("content-encoding") })
        return input.respond("{}", { status: 500 })
      }),
    )
    yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(Effect.provide(server), Effect.exit)
    return seen[0]
  })

describe("HTTP request encoding", () => {
  it.effect("gzips Anthropic requests to api.anthropic.com by default", () =>
    Effect.gen(function* () {
      // OpenCode passes the catalog's URL explicitly, so the default URL counts however it arrives.
      for (const model of [
        Anthropic.model("claude-haiku-5-5", { apiKey: "test" }),
        Anthropic.model("claude-haiku-5-5", { apiKey: "test", baseURL: "https://api.anthropic.com/v1/" }),
      ]) {
        const request = yield* sent(model)
        expect(request.url).toStartWith("https://api.anthropic.com/v1/messages")
        expect(request.encoding).toBe("gzip")
      }
    }),
  )

  it.effect("keeps Anthropic requests plain for another baseURL or an explicit encoding", () =>
    Effect.gen(function* () {
      const proxy = yield* sent(
        Anthropic.model("claude-haiku-5-5", { apiKey: "test", baseURL: "https://proxy.example/v1" }),
      )
      expect(proxy.encoding).toBeNull()
      const none = yield* sent(
        Anthropic.configure({ apiKey: "test", http: { encoding: "none" } }).model("claude-haiku-5-5"),
      )
      expect(none.encoding).toBeNull()
      // How OpenCode applies a configured encoding: on the model's options, over the route default.
      const base = Anthropic.model("claude-haiku-5-5", { apiKey: "test" })
      const configured = yield* sent(
        LanguageModel.update(base, { options: { ...base.options, http: { ...base.options?.http, encoding: "none" } } }),
      )
      expect(configured.encoding).toBeNull()
    }),
  )

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
