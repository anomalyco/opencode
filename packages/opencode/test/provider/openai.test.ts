import { expect, test } from "bun:test"
import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai"

test("OpenAI Responses forwards the ultrafast service tier", async () => {
  const requests: unknown[] = []
  const stop = new Error("request captured")
  const provider = createOpenAI({
    apiKey: "test-key",
    fetch: Object.assign(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push(await new Request(url, init).json())
        throw stop
      },
      { preconnect: () => undefined },
    ),
  })

  expect(
    await provider
      .responses("gpt-6-astra")
      .doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        providerOptions: {
          openai: { serviceTier: "ultrafast" } satisfies OpenAILanguageModelResponsesOptions,
        },
      })
      .then(undefined, (error: unknown) => error),
  ).toBe(stop)

  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ model: "gpt-6-astra", service_tier: "ultrafast" })
})
