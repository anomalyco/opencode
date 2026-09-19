import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM } from "../../src/index.js"
import { AmazonBedrock } from "../../src/providers.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const credentials = {
  region: "us-east-2",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
}

describe("Amazon Bedrock Runtime compatible APIs", () => {
  it.effect("keeps Converse as the default and exposes each semantic API", () =>
    Effect.gen(function* () {
      const provider = AmazonBedrock.configure({ credentials })
      const requests = yield* Effect.all([
        compileRequest(LLM.request({ model: provider.model("us.amazon.nova-2-lite-v1:0"), prompt: "Hi" })),
        compileRequest(LLM.request({ model: provider.responses("global.openai.gpt-5.6-sol"), prompt: "Hi" })),
        compileRequest(LLM.request({ model: provider.chat("openai.gpt-oss-120b-1:0"), prompt: "Hi" })),
        compileRequest(LLM.request({ model: provider.messages("global.anthropic.claude-sonnet-5"), prompt: "Hi" })),
      ])

      expect(requests.map((request) => [request.route, request.protocol])).toEqual([
        ["bedrock-converse", "bedrock-converse"],
        ["bedrock-responses", "open-responses"],
        ["bedrock-chat", "openai-chat"],
        ["bedrock-messages", "anthropic-messages"],
      ])
      expect(requests[1]?.body).toMatchObject({ model: "global.openai.gpt-5.6-sol", store: false })
      expect(requests[2]?.body).toMatchObject({ model: "openai.gpt-oss-120b-1:0" })
      expect(requests[3]?.body).toMatchObject({ model: "global.anthropic.claude-sonnet-5" })
    }),
  )

  it.effect("uses Runtime paths and signs every API with the Bedrock service", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly url: string; readonly authorization: string | undefined }> = []
      const provider = AmazonBedrock.configure({ credentials, region: "us-west-1" })
      const models = [
        provider.responses("global.openai.gpt-5.6-sol"),
        provider.chat("openai.gpt-oss-120b-1:0"),
        provider.messages("global.anthropic.claude-sonnet-5"),
      ]

      yield* Effect.forEach(models, (model) =>
        LLMClient.generate(LLM.request({ model, prompt: "Hi" })).pipe(
          Effect.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request)
                seen.push({ url: request.url, authorization: request.headers.get("authorization") ?? undefined })
                return input.respond(sseEvents({ type: "error", error: { message: "stop fixture" } }), {
                  headers: { "content-type": "text/event-stream" },
                })
              }),
            ),
          ),
          Effect.flip,
        ),
      )

      expect(seen.map((item) => item.url)).toEqual([
        "https://bedrock-runtime.us-west-1.amazonaws.com/openai/v1/responses",
        "https://bedrock-runtime.us-west-1.amazonaws.com/openai/v1/chat/completions",
        "https://bedrock-runtime.us-west-1.amazonaws.com/anthropic/v1/messages",
      ])
      expect(seen.every((item) => item.authorization?.includes("/us-west-1/bedrock/aws4_request"))).toBe(true)
    }),
  )

  it.effect("uses the protocol-specific API-key header", () =>
    Effect.gen(function* () {
      const seen: Array<Record<string, string | undefined>> = []
      const provider = AmazonBedrock.configure({ apiKey: "test-key", region: "us-east-1" })
      const models = [
        provider.responses("global.openai.gpt-5.6-sol"),
        provider.messages("us.anthropic.claude-sonnet-5"),
      ]

      yield* Effect.forEach(models, (model) =>
        LLMClient.generate(LLM.request({ model, prompt: "Hi" })).pipe(
          Effect.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const request = yield* HttpClientRequest.toWeb(input.request)
                seen.push({
                  authorization: request.headers.get("authorization") ?? undefined,
                  apiKey: request.headers.get("x-api-key") ?? undefined,
                })
                return input.respond(sseEvents({ type: "error", error: { message: "stop fixture" } }), {
                  headers: { "content-type": "text/event-stream" },
                })
              }),
            ),
          ),
          Effect.flip,
        ),
      )

      expect(seen).toEqual([
        { authorization: "Bearer test-key", apiKey: undefined },
        { authorization: undefined, apiKey: "test-key" },
      ])
    }),
  )
})
