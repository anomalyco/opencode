import { expect, test } from "bun:test"
import {
  createOpenAI,
  type OpenAILanguageModelChatOptions,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai"

for (const endpoint of ["chat", "responses"] as const) {
  for (const method of ["doGenerate", "doStream"] as const) {
    test.each(["auto", "flex", "priority", "default", "ultrafast"] as const)(
      `OpenAI ${endpoint} ${method} forwards service tier %s`,
      async (serviceTier) => {
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
        const model = provider[endpoint]("gpt-6-astra")
        expect(
          await model[method]({
            prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
            providerOptions: {
              openai: { serviceTier } satisfies OpenAILanguageModelChatOptions & OpenAILanguageModelResponsesOptions,
            },
          }).then(undefined, (error: unknown) => error),
        ).toBe(stop)

        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({ model: "gpt-6-astra", service_tier: serviceTier })
      },
    )

    test(`OpenAI ${endpoint} ${method} still rejects unknown service tiers`, async () => {
      const requests: unknown[] = []
      const provider = createOpenAI({
        apiKey: "test-key",
        fetch: Object.assign(
          async (url: RequestInfo | URL, init?: RequestInit) => {
            requests.push(await new Request(url, init).json())
            throw new Error("unexpected request")
          },
          { preconnect: () => undefined },
        ),
      })
      const model = provider[endpoint]("gpt-6-astra")

      expect(
        await model[method]({
          prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          providerOptions: { openai: { serviceTier: "unsupported-tier" } },
        }).then(undefined, (error: unknown) => error),
      ).toMatchObject({ message: "invalid openai provider options" })
      expect(requests).toHaveLength(0)
    })
  }
}
