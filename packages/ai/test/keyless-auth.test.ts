import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ai } from "../src/index.js"
import { Anthropic, OpenAICompatible } from "../src/providers.js"
import { sseEvents } from "./lib/sse.js"

const seen: Array<Headers> = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push(request.headers)
      if (new URL(request.url).pathname.endsWith("/images/generations"))
        return Response.json({ data: [{ b64_json: "AQID" }], output_format: "png" })
      if (new URL(request.url).pathname.endsWith("/messages"))
        return new Response(
          sseEvents(
            { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
            { type: "message_stop" },
          ),
          { headers: { "content-type": "text/event-stream" } },
        )
      return new Response(
        sseEvents({ choices: [{ delta: { content: "ok" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
})

afterAll(() => server.stop(true))

const baseURL = () => `http://127.0.0.1:${server.port}/v1`

const lastHeaders = () => {
  const headers = seen.at(-1)
  if (!headers) throw new Error("stub saw no request")
  return headers
}

describe("apiKey: false", () => {
  test("an OpenAI-compatible model without a key still fails by default", async () => {
    const model = OpenAICompatible.model("local", { baseURL: baseURL() })
    await expect(ai.generate({ model, prompt: "hi" })).rejects.toThrow("Missing auth credential: apiKey")
  })

  test("an OpenAI-compatible model sends no Authorization header", async () => {
    const model = OpenAICompatible.model("local", { apiKey: false, baseURL: baseURL() })
    const response = await ai.generate({ model, prompt: "hi" })
    expect(response.text).toBe("ok")
    expect(lastHeaders().get("authorization")).toBeNull()
  })

  test("custom headers are the only auth sent", async () => {
    const model = OpenAICompatible.configure({
      apiKey: false,
      baseURL: baseURL(),
      headers: { "x-gateway-token": "t" },
    }).model("local")
    await ai.generate({ model, prompt: "hi" })
    expect(lastHeaders().get("authorization")).toBeNull()
    expect(lastHeaders().get("x-gateway-token")).toBe("t")
  })

  test("image models share the keyless auth", async () => {
    const model = OpenAICompatible.configure({ apiKey: false, baseURL: baseURL() }).image("gpt-image-2")
    const response = await ai.image.generate({ model, prompt: "a lighthouse" })
    expect(response.images).toHaveLength(1)
    expect(lastHeaders().get("authorization")).toBeNull()
  })

  test("Anthropic sends no x-api-key header", async () => {
    const model = Anthropic.model("claude-local", { apiKey: false, baseURL: baseURL() })
    const response = await ai.generate({ model, prompt: "hi" })
    expect(response.text).toBe("ok")
    expect(lastHeaders().get("x-api-key")).toBeNull()
    expect(lastHeaders().get("authorization")).toBeNull()
  })
})
