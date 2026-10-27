import { describe, expect } from "bun:test"
import { gunzipSync, zstdDecompressSync } from "node:zlib"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { LLM, type RequestEncoding } from "../src/effect.js"
import { LLMClient } from "../src/route.js"
import { configure } from "../src/providers/openai.js"
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
