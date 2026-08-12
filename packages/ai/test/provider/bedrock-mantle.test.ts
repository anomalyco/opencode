import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM } from "../../src/index.js"
import { AmazonBedrockMantle } from "../../src/providers.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { recordedTests } from "../recorded-test.js"

const credentials = {
  region: "us-east-2",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
}

describe("Amazon Bedrock Mantle provider", () => {
  it.effect("uses Chat by default and exposes Responses", () =>
    Effect.gen(function* () {
      const provider = AmazonBedrockMantle.configure({ credentials })
      const chat = yield* compileRequest(LLM.request({ model: provider.model("openai.gpt-oss-120b"), prompt: "Hi" }))
      const responses = yield* compileRequest(
        LLM.request({ model: provider.responses("openai.gpt-oss-120b"), prompt: "Hi" }),
      )

      expect(chat).toMatchObject({
        route: "bedrock-mantle-chat",
        protocol: "openai-chat",
        body: { model: "openai.gpt-oss-120b" },
      })
      expect(responses).toMatchObject({
        route: "bedrock-mantle-responses",
        protocol: "openai-responses",
        body: { model: "openai.gpt-oss-120b", store: false },
      })
    }),
  )

  it.effect("uses the Mantle endpoint and signing service", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly url: string; readonly authorization: string | undefined }> = []
      const model = AmazonBedrockMantle.configure({ credentials, region: "us-west-1" }).responses("openai.gpt-oss-120b")
      yield* LLMClient.generate(LLM.request({ model, prompt: "Hi" })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request)
              seen.push({ url: request.url, authorization: request.headers.get("authorization") ?? undefined })
              return input.respond("", { headers: { "content-type": "text/event-stream" } })
            }),
          ),
        ),
        Effect.flip,
      )

      expect(seen[0]?.url).toBe("https://bedrock-mantle.us-west-1.api.aws/v1/responses")
      expect(seen[0]?.authorization).toContain("/us-west-1/bedrock-mantle/aws4_request")
    }),
  )

  it.effect("supports bearer authentication and custom base URLs", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly url: string; readonly authorization: string | undefined }> = []
      const model = AmazonBedrockMantle.configure({
        apiKey: "test-key",
        baseURL: "https://mantle.test/v1",
      }).chat("openai.gpt-oss-safeguard-20b")
      yield* LLMClient.generate(LLM.request({ model, prompt: "Hi" })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request)
              seen.push({ url: request.url, authorization: request.headers.get("authorization") ?? undefined })
              return input.respond("", { headers: { "content-type": "text/event-stream" } })
            }),
          ),
        ),
        Effect.flip,
      )

      expect(seen).toEqual([{ url: "https://mantle.test/v1/chat/completions", authorization: "Bearer test-key" }])
    }),
  )
})

const recorded = recordedTests({
  prefix: "bedrock-mantle",
  provider: "amazon-bedrock",
  protocol: "openai-responses",
  requires: ["AWS_BEARER_TOKEN_BEDROCK"],
  metadata: { model: "openai.gpt-oss-120b" },
})

describe("Amazon Bedrock Mantle recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: AmazonBedrockMantle.configure({
            apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
            region: "us-east-1",
          }).responses("openai.gpt-oss-120b"),
          prompt: "Reply with exactly: hello",
          generation: { maxTokens: 256, temperature: 0 },
        }),
      )

      expect(response.text.trim().toLowerCase()).toBe("hello")
    }),
  )
})
