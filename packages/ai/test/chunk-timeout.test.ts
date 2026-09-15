import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AIError, LLM } from "../src/index.js"
import { HttpOptions, mergeHttpOptions } from "../src/schema/options.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { LLMClient } from "../src/route.js"
import { dynamicResponse } from "./lib/http.js"
import { it } from "./lib/effect.js"

const headers = { "content-type": "text/event-stream" }

// Sends one SSE frame, then holds the connection open without further data.
// Only a configured chunkTimeout can terminate the read.
const stalledResponse = dynamicResponse((input) =>
  Effect.sync(() => {
    const encoder = new TextEncoder()
    let sent = false
    const stream = new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(encoder.encode('data: {"choices":[]}\n\n'))
        }
      },
    })
    return input.respond(stream, { headers })
  }),
)

describe("chunkTimeout", () => {
  it.live("aborts a stalled HTTP SSE stream with a typed transport error", () =>
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ http: { chunkTimeout: 100 } })
      const request = LLM.request({ model: route.model({ id: "test" }), prompt: "Hello" })
      const error = yield* LLMClient.generate(request).pipe(Effect.provide(stalledResponse), Effect.flip)

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        operation: "read",
        phase: "receive",
        code: "chunk-timeout",
      })
      expect(error.message).toContain("chunkTimeout")
    }),
  )

  test("mergeHttpOptions keeps the rightmost configured chunkTimeout", () => {
    const merged = mergeHttpOptions(new HttpOptions({ chunkTimeout: 1000 }), new HttpOptions({ chunkTimeout: 250 }))
    expect(merged?.chunkTimeout).toBe(250)
    expect(mergeHttpOptions(new HttpOptions({ chunkTimeout: 250 }))?.chunkTimeout).toBe(250)
    expect(mergeHttpOptions(new HttpOptions({ body: { a: 1 } }))?.chunkTimeout).toBeUndefined()
    expect(mergeHttpOptions(new HttpOptions({ chunkTimeout: 250 }), new HttpOptions())?.chunkTimeout).toBe(250)
  })
})
