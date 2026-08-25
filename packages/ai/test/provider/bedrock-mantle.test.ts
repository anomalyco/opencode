import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, Message } from "../../src/index.js"
import { AmazonBedrockMantle } from "../../src/providers.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"
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
              return input.respond(sseEvents({ choices: [{ delta: {}, finish_reason: "stop" }] }), {
                headers: { "content-type": "text/event-stream" },
              })
            }),
          ),
        ),
      )

      expect(seen).toEqual([{ url: "https://mantle.test/v1/chat/completions", authorization: "Bearer test-key" }])
    }),
  )

  it.effect("replays reasoning with Mantle's message-prefixed item ids", () =>
    Effect.gen(function* () {
      const model = AmazonBedrockMantle.configure({ apiKey: "test-key" }).responses("openai.gpt-oss-120b")
      const item = { type: "reasoning", id: "msg_95d4d0af4350432a", encrypted_content: "mantle-state" }
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Think." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.added", item },
              { type: "response.reasoning_summary_text.delta", item_id: item.id, delta: "Considering." },
              { type: "response.output_item.done", item },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      const prepared = yield* compileRequest(
        LLM.request({ model, messages: [response.message, Message.user("Continue.")] }),
      )

      expect(prepared.body.input).toEqual([
        {
          type: "reasoning",
          id: "msg_95d4d0af4350432a",
          summary: [{ type: "summary_text", text: "Considering." }],
          encrypted_content: "mantle-state",
        },
        { role: "user", content: [{ type: "input_text", text: "Continue." }] },
      ])
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
