import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { LLM, LLMEvent, LLMRequest, Message, ToolDefinition } from "../../src/index.js"
import { AmazonBedrockMantle } from "../../src/providers.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
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
  it.effect("uses Responses by default and exposes Chat and Messages explicitly", () =>
    Effect.gen(function* () {
      const provider = AmazonBedrockMantle.configure({ credentials })
      expect(provider.model("openai.gpt-oss-120b").route.transport).toBe(OpenResponses.httpTransport)
      const chat = yield* compileRequest(LLM.request({ model: provider.chat("openai.gpt-oss-120b"), prompt: "Hi" }))
      const messages = yield* compileRequest(
        LLM.request({ model: provider.messages("anthropic.claude-opus-4-8"), prompt: "Hi", cache: "none" }),
      )
      const responses = yield* compileRequest(
        LLM.request({ model: provider.model("openai.gpt-oss-120b"), prompt: "Hi" }),
      )

      expect(chat).toMatchObject({
        route: "bedrock-mantle-chat",
        protocol: "openai-chat",
        body: { model: "openai.gpt-oss-120b" },
      })
      expect(messages).toMatchObject({
        route: "bedrock-mantle-messages",
        protocol: "anthropic-messages",
        body: { model: "anthropic.claude-opus-4-8", stream: true },
      })
      expect(responses).toMatchObject({
        route: "bedrock-mantle-responses",
        protocol: "open-responses",
        body: { model: "openai.gpt-oss-120b", store: false },
      })
      expect(provider.model("openai.gpt-oss-120b").route.providerMetadataKey).toBe("mantle")
      expect(provider.chat("openai.gpt-oss-120b").route.providerMetadataKey).toBe("mantle")
      expect(provider.messages("anthropic.claude-opus-4-8").route.providerMetadataKey).toBe("mantle")
    }),
  )

  it.effect("preserves configured top-p generation defaults for Chat, Messages, and Responses", () =>
    Effect.gen(function* () {
      const settings = { apiKey: "test-key", topP: 0.8 }
      const chat = yield* compileRequest(
        LLM.request({ model: AmazonBedrockMantle.chatModel("openai.gpt-oss-safeguard-20b", settings), prompt: "Hi" }),
      )
      const messages = yield* compileRequest(
        LLM.request({ model: AmazonBedrockMantle.messagesModel("anthropic.claude-opus-4-8", settings), prompt: "Hi" }),
      )
      const responses = yield* compileRequest(
        LLM.request({ model: AmazonBedrockMantle.responsesModel("openai.gpt-oss-120b", settings), prompt: "Hi" }),
      )

      expect(chat.body.top_p).toBe(0.8)
      expect(messages.body.top_p).toBe(0.8)
      expect(responses.body.top_p).toBe(0.8)
    }),
  )

  it.effect("uses the Mantle endpoint and signing service across Responses and Messages", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly url: string; readonly authorization: string | undefined }> = []
      const configured = AmazonBedrockMantle.configure({ credentials, region: "us-west-1" })
      for (const selected of [
        configured.responses("openai.gpt-oss-120b"),
        configured.messages("anthropic.claude-opus-4-8"),
      ]) {
        yield* LLMClient.generate(LLM.request({ model: selected, prompt: "Hi" })).pipe(
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
      }

      expect(seen.map((item) => item.url)).toEqual([
        "https://bedrock-mantle.us-west-1.api.aws/v1/responses",
        "https://bedrock-mantle.us-west-1.api.aws/anthropic/v1/messages",
      ])
      expect(seen.every((item) => item.authorization?.includes("/us-west-1/bedrock-mantle/aws4_request"))).toBe(true)
    }).pipe(withProcessEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined })),
  )

  it.effect("applies inline cache breakpoints on Mantle Messages", () =>
    Effect.gen(function* () {
      const model = AmazonBedrockMantle.configure({ apiKey: "test-key" }).messages("anthropic.claude-opus-4-8")
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          system: "You are concise.",
          messages: [Message.user("Hello")],
          cache: "auto",
        }),
      )

      expect(prepared.body.system).toEqual([
        { type: "text", text: "You are concise.", cache_control: { type: "ephemeral" } },
      ])
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }] },
      ])
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
        { type: "message", role: "user", content: [{ type: "input_text", text: "Continue." }] },
      ])
    }),
  )
})

const recorded = recordedTests({
  prefix: "bedrock-mantle",
  provider: "amazon-bedrock",
  protocol: "open-responses",
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

const recordedMessages = recordedTests({
  prefix: "bedrock-mantle-messages",
  provider: "amazon-bedrock",
  protocol: "anthropic-messages",
  requires: ["AWS_BEARER_TOKEN_BEDROCK"],
  options: { redact: { allowRequestHeaders: ["anthropic-version", "anthropic-beta"] } },
})

const mantleMessages = (modelID: string) =>
  AmazonBedrockMantle.configure({
    apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
    region: "us-east-1",
  }).messages(modelID)

const weatherTool = ToolDefinition.make({
  name: "get_weather",
  description: "Get the current weather in a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", enum: ["Paris"] } },
    required: ["city"],
    additionalProperties: false,
  },
})

describe("Amazon Bedrock Mantle Messages recorded", () => {
  recordedMessages.effect.with(
    "replays signed thinking through a tool loop and native system update",
    { tags: ["tool", "tool-loop", "reasoning", "system-update"], metadata: { model: "anthropic.claude-opus-4-8" } },
    () =>
      Effect.gen(function* () {
        const model = mantleMessages("anthropic.claude-opus-4-8")
        const initial = LLM.request({
          model,
          system: "You are a concise assistant.",
          prompt:
            "First calculate 37 * 43. Then call get_weather for Paris. After receiving the tool result, state both the product and the weather.",
          tools: [weatherTool],
          providerOptions: {
            thinking: { type: "adaptive", display: "summarized" },
            effort: "medium",
          },
          generation: { maxTokens: 2048 },
        })
        const first = yield* LLMClient.generate(initial)
        expect(first.finishReason.normalized).toBe("tool-calls")
        expect(first.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
        expect(first.reasoning.length).toBeGreaterThan(0)
        expect(first.events.some(LLMEvent.is.toolInputDelta)).toBe(true)
        const reasoningPart = first.message.content.find((part) => part.type === "reasoning")
        const signature = (reasoningPart?.providerMetadata?.mantle as { readonly signature?: unknown } | undefined)
          ?.signature
        expect(typeof signature).toBe("string")

        const followUp = LLMRequest.update(initial, {
          messages: [
            ...initial.messages,
            first.message,
            ...first.toolCalls.map((call) =>
              Message.tool({ id: call.id, name: call.name, result: { condition: "sunny", temperatureC: 18 } }),
            ),
            Message.system("Reply in French in one short sentence."),
          ],
        })
        const compiled = yield* compileRequest(followUp)
        expect(compiled.body.messages[1]?.content[0]).toEqual({
          type: "thinking",
          thinking: first.reasoning,
          signature: signature as string,
        })
        expect(compiled.body.messages.at(-1)).toEqual({
          role: "system",
          content: [
            { type: "text", text: "Reply in French in one short sentence.", cache_control: { type: "ephemeral" } },
          ],
        })

        const second = yield* LLMClient.generate(followUp)
        expect(second.finishReason.normalized).toBe("stop")
        expect(second.text).toContain("1591")
        expect(second.text).toContain("18")
      }),
    120_000,
  )

  recordedMessages.effect.with(
    "lowers system updates to wrapped user text on Haiku 4.5 with budget thinking",
    { tags: ["reasoning", "system-update"], metadata: { model: "anthropic.claude-haiku-4-5" } },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: mantleMessages("anthropic.claude-haiku-4-5"),
          messages: [Message.user("What is 19 multiplied by 23?"), Message.system("Reply with only the integer.")],
          providerOptions: {
            thinking: { type: "enabled", budgetTokens: 1024 },
          },
          generation: { maxTokens: 2048 },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 })
        expect(compiled.body.messages.some((message) => message.role === "system")).toBe(false)

        const response = yield* LLMClient.generate(request)
        expect(response.finishReason.normalized).toBe("stop")
        expect(response.reasoning.length).toBeGreaterThan(0)
        expect(response.text.trim()).toContain("437")
      }),
    120_000,
  )

  recordedMessages.effect.with(
    "applies mid-conversation effort updates and thinking block binding on Opus 5.5",
    { tags: ["reasoning", "effort-update"], metadata: { model: "anthropic.claude-opus-5-5" } },
    () =>
      Effect.gen(function* () {
        const model = mantleMessages("anthropic.claude-opus-5-5")
        const firstRequest = LLM.request({
          model,
          prompt: "Compute 37 * 43 step by step, then reply with only the integer.",
          providerOptions: {
            thinking: { type: "adaptive", display: "summarized" },
            effort: "high",
          },
          generation: { maxTokens: 2048 },
        })
        const firstCompiled = yield* compileRequest(firstRequest)
        expect(firstCompiled.body.thinking).toEqual({
          type: "adaptive",
          display: "summarized",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        })

        const first = yield* LLMClient.generate(firstRequest)
        expect(first.finishReason.normalized).toBe("stop")
        expect(first.reasoning.length).toBeGreaterThan(0)
        expect(first.text.replaceAll(",", "")).toContain("1591")

        const secondRequest = LLM.request({
          model,
          messages: [
            ...firstRequest.messages,
            first.message,
            Message.effort({ effort: "low", previous: "high" }),
            Message.user("Add 9 to that result. Reply with only the integer."),
          ],
          providerOptions: {
            thinking: { type: "adaptive", display: "summarized" },
            effort: "low",
          },
          generation: { maxTokens: 2048 },
        })
        const secondCompiled = yield* compileRequest(secondRequest)
        expect(secondCompiled.body.output_config).toEqual({ effort: "high" })
        expect(secondCompiled.body.messages.filter((message) => message.role === "system")).toEqual([
          { role: "system", content: [], output_config: { effort: "low" } },
        ])

        const second = yield* LLMClient.generate(secondRequest)
        expect(second.finishReason.normalized).toBe("stop")
        expect(second.text.replaceAll(",", "")).toContain("1600")
      }),
    120_000,
  )

  recordedMessages.effect.with(
    "strips unsupported mid-conversation effort updates on Opus 5.0",
    { tags: ["reasoning", "effort-update"], metadata: { model: "anthropic.claude-opus-5" } },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: mantleMessages("anthropic.claude-opus-5"),
          messages: [
            Message.user("What is 12 + 30?"),
            Message.assistant("42"),
            Message.effort({ effort: "low", previous: "high" }),
            Message.user("Add 8 to that result. Reply with only the integer."),
          ],
          providerOptions: {
            thinking: { type: "adaptive", display: "summarized" },
            effort: "low",
          },
          generation: { maxTokens: 1024 },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body.output_config).toEqual({ effort: "low" })
        expect(compiled.body.messages.some((message) => message.role === "system")).toBe(false)

        const response = yield* LLMClient.generate(request)
        expect(response.finishReason.normalized).toBe("stop")
        expect(response.text.trim()).toContain("50")
      }),
    120_000,
  )
})
