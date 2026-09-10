import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, Message, ToolDefinition } from "../../src/index.js"
import { AmazonBedrockMantle, OpenAI } from "../../src/providers.js"
import { model } from "../../src/providers/amazon-bedrock/mantle.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { withProcessEnv } from "../lib/env.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"
import { recordedTests } from "../recorded-test.js"

const credentials = {
  region: "us-east-2",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
}

describe("Amazon Bedrock Mantle provider", () => {
  ;[
    { model: AmazonBedrockMantle.configure({ apiKey: "test-key" }).responses("openai.gpt-oss-120b"), string: true },
    { model: AmazonBedrockMantle.configure({ apiKey: "test-key" }).responses("openai.gpt-oss-20b"), string: true },
    { model: AmazonBedrockMantle.configure({ apiKey: "test-key" }).responses("openai.gpt-5.6-luna"), string: false },
    { model: OpenAI.configure({ apiKey: "test-key" }).responses("openai.gpt-oss-120b"), string: false },
  ].forEach((fixture) => {
    it.effect(`replays assistant text for ${fixture.model.provider}/${fixture.model.id}`, () =>
      Effect.gen(function* () {
        const key = fixture.model.route.providerMetadataKey ?? "openresponses"
        const prepared = yield* compileRequest(
          LLM.request({
            model: fixture.model,
            messages: [
              Message.user("Say OK"),
              Message.assistant([
                {
                  type: "reasoning",
                  text: "Considering.",
                  providerMetadata: { [key]: { itemId: "rs_1", reasoningEncryptedContent: "opaque" } },
                },
                {
                  type: "text",
                  text: "OK",
                  providerMetadata: { [key]: { itemId: "msg_1", phase: "commentary" } },
                },
                { type: "tool-call", id: "call_1", name: "lookup", input: {} },
                { type: "text", text: "After call." },
                { type: "text", text: "More text." },
              ]),
              Message.tool({ id: "call_1", name: "lookup", result: { type: "text", value: "Done" } }),
              Message.user("Say TEST"),
            ],
            providerOptions: { reasoningEffort: "low" },
          }),
        )
        expect(prepared.body.reasoning).toMatchObject({ effort: "low" })
        expect(prepared.body.input).toEqual([
          { role: "user", content: [{ type: "input_text", text: "Say OK" }] },
          {
            type: "reasoning",
            id: "rs_1",
            summary: [{ type: "summary_text", text: "Considering." }],
            encrypted_content: "opaque",
          },
          {
            type: "message",
            id: "msg_1",
            role: "assistant",
            phase: "commentary",
            status: "completed",
            content: fixture.string ? "OK" : [{ type: "output_text", text: "OK" }],
          },
          { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: fixture.string
              ? "After call.\nMore text."
              : [
                  { type: "output_text", text: "After call." },
                  { type: "output_text", text: "More text." },
                ],
          },
          { type: "function_call_output", call_id: "call_1", output: "Done" },
          { role: "user", content: [{ type: "input_text", text: "Say TEST" }] },
        ])
      }),
    )
  })
  ;["openai.gpt-oss-120b", "openai.gpt-oss-20b", "openai.gpt-5.6-luna"].forEach((id) => {
    it.effect(`disables tools for ${id} using its supported request shape`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          LLM.request({
            model: AmazonBedrockMantle.configure({ apiKey: "test-key" }).responses(id),
            prompt: "Give the final answer.",
            tools: [ToolDefinition.make({ name: "lookup", description: "Look up a value", inputSchema: {} })],
            toolChoice: "none",
          }),
        )
        if (id === "openai.gpt-5.6-luna") {
          expect(prepared.body.tool_choice).toBe("none")
          expect(prepared.body.tools).toHaveLength(1)
          return
        }
        expect(prepared.body.tool_choice).toBeUndefined()
        expect(prepared.body.tools).toBeUndefined()
      }),
    )
  })

  it.effect("uses Responses by default and exposes Chat explicitly", () =>
    Effect.gen(function* () {
      const provider = AmazonBedrockMantle.configure({ credentials })
      expect(provider.model).toBe(provider.responses)
      expect(AmazonBedrockMantle.model).toBe(AmazonBedrockMantle.responsesModel)
      expect(model).toBe(AmazonBedrockMantle.responsesModel)
      expect(provider.model("openai.gpt-oss-120b").route.transport).toBe(OpenAIResponses.httpTransport)
      const chat = yield* compileRequest(LLM.request({ model: provider.chat("openai.gpt-oss-120b"), prompt: "Hi" }))
      const responses = yield* compileRequest(
        LLM.request({ model: provider.model("openai.gpt-oss-120b"), prompt: "Hi" }),
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
      expect(provider.model("openai.gpt-oss-120b").route.providerMetadataKey).toBe("mantle")
      expect(provider.chat("openai.gpt-oss-120b").route.providerMetadataKey).toBe("mantle")
    }),
  )

  it.effect("preserves configured top-p generation defaults for Chat and Responses", () =>
    Effect.gen(function* () {
      const settings = { apiKey: "test-key", topP: 0.8 }
      const chat = yield* compileRequest(
        LLM.request({ model: AmazonBedrockMantle.chatModel("openai.gpt-oss-safeguard-20b", settings), prompt: "Hi" }),
      )
      const responses = yield* compileRequest(
        LLM.request({ model: AmazonBedrockMantle.responsesModel("openai.gpt-oss-120b", settings), prompt: "Hi" }),
      )

      expect(chat.body.top_p).toBe(0.8)
      expect(responses.body.top_p).toBe(0.8)
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

  it.effect("signs with the Mantle service using default-chain credentials", () =>
    Effect.gen(function* () {
      const seen: Array<string | undefined> = []
      const model = AmazonBedrockMantle.configure({ region: "us-west-1" }).responses("openai.gpt-oss-120b")
      yield* LLMClient.generate(LLM.request({ model, prompt: "Hi" })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request)
              seen.push(request.headers.get("authorization") ?? undefined)
              return input.respond("", { headers: { "content-type": "text/event-stream" } })
            }),
          ),
        ),
        Effect.flip,
      )

      expect(seen[0]).toContain("Credential=AKIACHAINEXAMPLE/")
      expect(seen[0]).toContain("/us-west-1/bedrock-mantle/aws4_request")
    }).pipe(
      withProcessEnv({
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_PROFILE: undefined,
        AWS_ACCESS_KEY_ID: "AKIACHAINEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "chain-secret",
        AWS_SESSION_TOKEN: undefined,
      }),
    ),
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

      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        mantle: { itemId: "msg_95d4d0af4350432a", reasoningEncryptedContent: "mantle-state" },
      })
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
