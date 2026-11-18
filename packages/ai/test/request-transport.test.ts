import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AI } from "../src/index.js"
import { OpenAI } from "../src/providers.js"
import { RequestExecutor } from "../src/route.js"
import { handlerLayer } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const openai = OpenAI.configure({
  apiKey: "test",
  baseURL: "https://openai.test/v1",
  headers: { "x-shared": "provider" },
})

const chatBody = sseEvents(
  { choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] },
)

// The client's own HTTP client must never be reached when a call brings its own `fetch`.
const unreachable = RequestExecutor.layer.pipe(
  Layer.provide(handlerLayer(() => Effect.die(new Error("the client's HTTP client was used")))),
)

const recording = (response: () => Response) => {
  const seen: Array<Request> = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return response()
  }
  return { seen, fetch: Object.assign(fetch, { preconnect: globalThis.fetch.preconnect }) }
}

describe("request transport fields", () => {
  test("sends a text call through its own fetch with call headers winning", async () => {
    const ai = AI.make({ layer: unreachable })
    const recorder = recording(() => new Response(chatBody, { headers: { "content-type": "text/event-stream" } }))

    const response = await ai.generate({
      model: openai.chat("gpt-4o-mini"),
      prompt: "Say hello.",
      fetch: recorder.fetch,
      headers: { "x-shared": "call" },
      http: { query: { trace: "1" } },
    })

    expect(response.text).toBe("Hello")
    expect(recorder.seen.map((request) => request.url)).toEqual(["https://openai.test/v1/chat/completions?trace=1"])
    expect(recorder.seen[0]?.headers.get("x-shared")).toBe("call")
    await ai.dispose()
  })

  test("sends an image call through its own fetch", async () => {
    const ai = AI.make({ layer: unreachable })
    const recorder = recording(
      () =>
        new Response(JSON.stringify({ data: [{ b64_json: "AQID" }], output_format: "png" }), {
          headers: { "content-type": "application/json" },
        }),
    )

    const response = await ai.image.generate({
      model: openai.image("gpt-image-1"),
      prompt: "A lighthouse",
      fetch: recorder.fetch,
      headers: { "x-call": "yes" },
    })

    expect(response.images).toHaveLength(1)
    expect(recorder.seen[0]?.url).toBe("https://openai.test/v1/images/generations")
    expect(recorder.seen[0]?.headers.get("x-call")).toBe("yes")
    await ai.dispose()
  })
})
