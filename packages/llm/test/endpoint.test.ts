import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { InvalidRequestError, LLM } from "../src"
import { Endpoint } from "../src/adapter"

const request = (input: {
  readonly baseURL?: string
  readonly queryParams?: Record<string, string>
} = {}) =>
  LLM.request({
    model: LLM.model({
      id: "model-1",
      provider: "test",
      protocol: "test-protocol",
      baseURL: input.baseURL,
      queryParams: input.queryParams,
    }),
    prompt: "hello",
  })

describe("Endpoint", () => {
  test("renders static base URL and path", async () => {
    const url = await Effect.runPromise(
      Endpoint.render(Endpoint.baseURL({ default: "https://api.example.test/v1/", path: "/chat" }), {
        request: request(),
        payload: {},
      }),
    )

    expect(url.toString()).toBe("https://api.example.test/v1/chat")
  })

  test("model baseURL overrides adapter default and query params are appended", async () => {
    const url = await Effect.runPromise(
      Endpoint.render(Endpoint.baseURL({ default: "https://api.example.test/v1", path: "/chat?alt=sse" }), {
        request: request({
          baseURL: "https://custom.example.test/root/",
          queryParams: { "api-version": "2026-01-01", alt: "json" },
        }),
        payload: {},
      }),
    )

    expect(url.toString()).toBe("https://custom.example.test/root/chat?alt=json&api-version=2026-01-01")
  })

  test("renders dynamic base URL and final payload path", async () => {
    const url = await Effect.runPromise(
      Endpoint.render(
        Endpoint.baseURL<{ readonly modelId: string }>({
          default: () => "https://bedrock-runtime.us-east-1.amazonaws.com",
          path: ({ payload }) => `/model/${encodeURIComponent(payload.modelId)}/converse-stream`,
        }),
        {
          request: request(),
          payload: { modelId: "us.amazon.nova-micro-v1:0" },
        },
      ),
    )

    expect(url.toString()).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/model/us.amazon.nova-micro-v1%3A0/converse-stream")
  })

  test("fails when no model or adapter baseURL is available", async () => {
    const error = await Effect.runPromise(
      Endpoint.render(Endpoint.baseURL({ path: "/chat", required: "test endpoint requires a baseURL" }), {
        request: request(),
        payload: {},
      }).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(InvalidRequestError)
    expect(error.message).toBe("test endpoint requires a baseURL")
  })
})
