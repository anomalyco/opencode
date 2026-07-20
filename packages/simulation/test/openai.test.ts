import { expect, test } from "bun:test"
import { DEFAULT_BASE_URL, PATH } from "@opencode-ai/ai/protocols/openai-chat"
import { Effect, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { HttpClientError } from "effect/unstable/http/HttpClientError"
import { SimulationOpenAI } from "../src/backend/openai"
import { SimulatedProvider } from "../src/backend/simulated-provider"

test("encodes every simulated provider event as OpenAI SSE", async () => {
  const provider: SimulatedProvider.Interface = {
    stream: () =>
      Stream.make(
        { type: "textDelta", text: "Hello " },
        { type: "textDelta", text: "from Drive" },
        { type: "finish", reason: "stop" },
      ),
  }
  const url = new URL(DEFAULT_BASE_URL + PATH)
  const request = HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe({ model: "gpt-5" }))
  const matched = SimulationOpenAI.route(provider).match(request, url)
  if (!matched) throw new Error("The simulated OpenAI route did not match")

  const body = await Effect.runPromise(matched.pipe(Effect.flatMap((response) => response.text)))

  expect(body).toBe(
    [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}',
      'data: {"choices":[{"delta":{"content":"from Drive"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n"),
  )
})

test("encodes provider-neutral partial tool input as OpenAI deltas", async () => {
  const provider: SimulatedProvider.Interface = {
    stream: () =>
      Stream.make(
        { type: "toolInputStart", index: 0, id: "call_lookup", name: "lookup" },
        { type: "toolInputDelta", index: 0, text: '{"query":' },
        { type: "toolInputDelta", index: 0, text: '"OpenCode"}' },
        { type: "finish", reason: "tool-calls" },
      ),
  }
  const url = new URL(DEFAULT_BASE_URL + PATH)
  const request = HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe({ model: "gpt-5" }))
  const matched = SimulationOpenAI.route(provider).match(request, url)
  if (!matched) throw new Error("The simulated OpenAI route did not match")

  const body = await Effect.runPromise(matched.pipe(Effect.flatMap((response) => response.text)))

  expect(body).toBe(
    [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_lookup","function":{"name":"lookup","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"OpenCode\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n"),
  )
})

test("rejects malformed intercepted OpenAI JSON as an HTTP client error", async () => {
  const provider: SimulatedProvider.Interface = { stream: () => Stream.empty }
  const url = new URL(DEFAULT_BASE_URL + PATH)
  const request = HttpClientRequest.post(url).pipe(HttpClientRequest.bodyText("{"))
  const matched = SimulationOpenAI.route(provider).match(request, url)
  if (!matched) throw new Error("The simulated OpenAI route did not match")

  const error = await Effect.runPromise(matched.pipe(Effect.flip))

  expect(error).toBeInstanceOf(HttpClientError)
  expect(error.reason._tag).toBe("TransportError")
})
