import { describe, expect, test } from "bun:test"
import { LLM } from "../src"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { Endpoint } from "../src/route"
import { Model } from "../src/schema"

const request = () =>
  LLM.request({
    model: Model.make({
      id: "model-1",
      provider: "test",
      route: OpenAIChat.route,
    }),
    prompt: "hello",
  })

describe("Endpoint", () => {
  test("appends a static path to the model's baseURL", () => {
    const url = Endpoint.render(Endpoint.path("/chat", { baseURL: "https://api.example.test/v1/" }), {
      request: request(),
      body: {},
    })

    expect(url.toString()).toBe("https://api.example.test/v1/chat")
  })

  test("endpoint query params are appended to the rendered URL", () => {
    const url = Endpoint.render(
      Endpoint.path("/chat?alt=sse", {
        baseURL: "https://custom.example.test/root/",
        query: { "api-version": "2026-01-01", alt: "json" },
      }),
      {
        request: request(),
        body: {},
      },
    )

    expect(url.toString()).toBe("https://custom.example.test/root/chat?alt=json&api-version=2026-01-01")
  })

  test("path may be a function of the validated body", () => {
    const url = Endpoint.render(
      Endpoint.path<{ readonly modelId: string }>(
        ({ body }) => `/model/${encodeURIComponent(body.modelId)}/converse-stream`,
        { baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com" },
      ),
      {
        request: request(),
        body: { modelId: "us.amazon.nova-micro-v1:0" },
      },
    )

    expect(url.toString()).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.amazon.nova-micro-v1%3A0/converse-stream",
    )
  })
})
