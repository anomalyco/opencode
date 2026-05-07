import { describe, expect, test } from "bun:test"
import { LLM } from "../src"
import { Endpoint } from "../src/route"

const request = (
  input: {
    readonly baseURL: string
    readonly queryParams?: Record<string, string>
  },
) =>
  LLM.request({
    model: LLM.model({
      id: "model-1",
      provider: "test",
      route: "test-route",
      baseURL: input.baseURL,
      queryParams: input.queryParams,
    }),
    prompt: "hello",
  })

describe("Endpoint", () => {
  test("appends a static path to the model's baseURL", () => {
    const url = Endpoint.render(Endpoint.path("/chat"), {
      request: request({ baseURL: "https://api.example.test/v1/" }),
      body: {},
    })

    expect(url.toString()).toBe("https://api.example.test/v1/chat")
  })

  test("model query params are appended to the rendered URL", () => {
    const url = Endpoint.render(Endpoint.path("/chat?alt=sse"), {
      request: request({
        baseURL: "https://custom.example.test/root/",
        queryParams: { "api-version": "2026-01-01", alt: "json" },
      }),
      body: {},
    })

    expect(url.toString()).toBe("https://custom.example.test/root/chat?alt=json&api-version=2026-01-01")
  })

  test("path may be a function of the validated body", () => {
    const url = Endpoint.render(
      Endpoint.path<{ readonly modelId: string }>(({ body }) => `/model/${encodeURIComponent(body.modelId)}/converse-stream`),
      {
        request: request({ baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com" }),
        body: { modelId: "us.amazon.nova-micro-v1:0" },
      },
    )

    expect(url.toString()).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.amazon.nova-micro-v1%3A0/converse-stream",
    )
  })
})
