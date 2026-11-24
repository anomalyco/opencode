import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { ai, Media, Message, ToolDefinition } from "../../src/effect.js"
import { AmazonBedrock } from "../../src/providers.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { withProcessEnv } from "../lib/env.js"
import { dynamicResponse, json, observe, type Call } from "../lib/http.js"
import { deltaChunk } from "../lib/openai-chunks.js"
import { sseEvents, sseNamedEvent } from "../lib/sse.js"

const decodeBody = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

describe("Amazon Bedrock Runtime OpenAI routes", () => {
  it.effect("signs Chat with the Bedrock service and replays reasoning and tool results", () =>
    Effect.gen(function* () {
      const model = AmazonBedrock.chatModel("global.moonshotai.kimi-k3.1", {
        region: "us-west-2",
        auth: "sigv4",
      })
      const tool = ToolDefinition.make({
        name: "lookup",
        description: "Look up a value",
        inputSchema: { type: "object" },
      })
      const initial = ai.request({
        model,
        messages: [Message.user([{ type: "media", media: Media.base64("JVBERi0=", "application/pdf") }])],
        tools: [tool],
        maxTokens: 512,
        providerOptions: { reasoningEffort: "low" },
      })
      const calls: Call[] = []
      const client = dynamicResponse((input) =>
        Effect.gen(function* () {
          const { nth } = yield* observe(calls, input)
          return input.respond(
            nth === 1
              ? sseEvents(
                  deltaChunk({ reasoning_content: "Read the document." }),
                  deltaChunk({
                    tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{}" } }],
                  }),
                  deltaChunk({}, "tool_calls"),
                )
              : sseEvents(deltaChunk({ content: "Found it." }, "stop")),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )
      const first = yield* LLMClient.generate(initial).pipe(Effect.provide(client))
      expect(first.finishReason.normalized).toBe("tool-calls")
      expect(first.reasoning).toBe("Read the document.")
      expect(first.toolCalls).toMatchObject([{ id: "call_1", name: "lookup", input: {} }])

      const second = yield* LLMClient.generate({
        ...initial,
        messages: [
          ...initial.messages,
          first.message,
          Message.tool({ id: "call_1", name: "lookup", result: "42", resultType: "text" }),
        ],
      }).pipe(Effect.provide(client))
      expect(second.text).toBe("Found it.")
      expect(calls.map((call) => call.url)).toEqual(
        Array(2).fill("https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions"),
      )
      expect(calls[0]?.headers.get("authorization")).toMatch(
        /Credential=AKIACHAINEXAMPLE\/\d+\/us-west-2\/bedrock\/aws4_request/,
      )
      expect(decodeBody(calls[1].body)).toMatchObject({
        model: "global.moonshotai.kimi-k3.1",
        stream: true,
        max_tokens: 512,
        reasoning_effort: "low",
        messages: [
          { role: "user", content: [{ type: "file", file: { file_data: "data:application/pdf;base64,JVBERi0=" } }] },
          { role: "assistant", reasoning_content: "Read the document.", tool_calls: [{ id: "call_1" }] },
          { role: "tool", tool_call_id: "call_1", content: "42" },
        ],
      })
    }).pipe(
      withProcessEnv({
        AWS_BEARER_TOKEN_BEDROCK: "ignored-in-sigv4-mode",
        AWS_PROFILE: undefined,
        AWS_ACCESS_KEY_ID: "AKIACHAINEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "chain-secret",
        AWS_SESSION_TOKEN: undefined,
      }),
    ),
  )

  it.effect("streams Responses with bearer auth, a custom base URL, and stateless defaults", () =>
    Effect.gen(function* () {
      const model = AmazonBedrock.responsesModel("us.zai.glm-5.3", {
        apiKey: "test-key",
        baseURL: "https://runtime.test/openai/v1/",
      })
      const calls: Call[] = []
      const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "reasoning-state" }
      const response = yield* LLMClient.generate(ai.request({ model, prompt: "Hi", maxTokens: 512 })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              yield* observe(calls, input)
              return input.respond(
                sseEvents(
                  { type: "response.output_item.added", item: reasoning },
                  { type: "response.reasoning_summary_text.delta", item_id: reasoning.id, delta: "Considering." },
                  { type: "response.output_item.done", item: reasoning },
                  { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1" } },
                  { type: "response.output_text.delta", output_index: 0, item_id: "msg_1", delta: "Hi" },
                  { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1" } },
                  { type: "response.completed", response: { id: "resp_1" } },
                ),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
      expect(response.text).toBe("Hi")
      expect(calls[0]?.url).toBe("https://runtime.test/openai/v1/responses")
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-key")
      expect(decodeBody(calls[0].body)).toMatchObject({
        model: "us.zai.glm-5.3",
        max_output_tokens: 512,
        store: false,
        include: ["reasoning.encrypted_content"],
      })
      const followUp = yield* compileRequest(
        ai.request({ model, messages: [response.message, Message.user("Continue.")] }),
      )
      expect(followUp.body.input[0]).toMatchObject(reasoning)
    }),
  )

  it.effect("keeps legacy endpoint origins and does not fall back on HTTP errors", () =>
    Effect.gen(function* () {
      const provider = AmazonBedrock.configure({ baseURL: "https://vpce.test/" })
      expect(provider.model).toBe(provider.converse)
      expect(provider.model("us.moonshotai.kimi-k3").route).toMatchObject({
        id: "bedrock-converse",
        endpoint: { baseURL: "https://vpce.test/" },
      })
      const model = provider.chat("us.moonshotai.kimi-k3")
      const request = ai.request({ model, prompt: "Hi", maxTokens: 512 })
      const compiled = yield* compileRequest(request)
      expect(compiled.route).toBe("bedrock-runtime-chat")
      const calls: Call[] = []
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            observe(calls, input).pipe(
              Effect.map(() => json(input, { error: { message: "Unsupported model" } }, { status: 400 })),
            ),
          ),
        ),
        Effect.flip,
      )
      expect(error.reason.message).toContain("Unsupported model")
      expect(calls.map((call) => call.url)).toEqual(["https://vpce.test/openai/v1/chat/completions"])
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer ambient-key")
    }).pipe(withProcessEnv({ AWS_BEARER_TOKEN_BEDROCK: "ambient-key" })),
  )
})

describe("Amazon Bedrock Runtime Messages", () => {
  it.effect("streams Claude thinking and tool use and replays them with an inference profile", () =>
    Effect.gen(function* () {
      const model = AmazonBedrock.messagesModel("global.anthropic.claude-sonnet-4-6", {
        baseURL: "https://vpce.test/anthropic/",
        thinking: { type: "adaptive" },
        effort: "high",
      })
      const request = ai.request({
        model,
        prompt: "Look up the answer.",
        tools: [
          ToolDefinition.make({ name: "lookup", description: "Look up a value", inputSchema: { type: "object" } }),
        ],
        maxTokens: 2048,
        cache: "none",
      })
      const calls: Call[] = []
      const body = [
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Reasoning." } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_1" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
        },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"key":"value"}' } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 8 } },
        { type: "message_stop" },
      ]
        .map((event) => `${sseNamedEvent(event.type, event)}\n\n`)
        .join("")
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            observe(calls, input).pipe(
              Effect.map(() => input.respond(body, { headers: { "content-type": "text/event-stream" } })),
            ),
          ),
        ),
      )
      expect(calls[0]?.url).toBe("https://vpce.test/anthropic/v1/messages")
      expect(calls[0]?.headers.get("x-api-key")).toBe("ambient-key")
      expect(calls[0]?.headers.get("authorization")).toBeNull()
      expect(calls[0]?.headers.get("anthropic-version")).toBe("2023-06-01")
      expect(decodeBody(calls[0].body)).toMatchObject({
        model: "global.anthropic.claude-sonnet-4-6",
        stream: true,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      })
      expect(calls[0].body).not.toContain("anthropic_version")
      expect(response.finishReason.normalized).toBe("tool-calls")
      expect(response.reasoning).toBe("Reasoning.")
      expect(response.toolCalls).toMatchObject([{ id: "toolu_1", name: "lookup", input: { key: "value" } }])

      const followUp = yield* compileRequest({
        ...request,
        messages: [
          ...request.messages,
          response.message,
          Message.tool({ id: "toolu_1", name: "lookup", result: "42", resultType: "text" }),
        ],
      })
      expect(followUp.body.messages.slice(-2)).toMatchObject([
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Reasoning.", signature: "sig_1" },
            { type: "tool_use", id: "toolu_1", name: "lookup", input: { key: "value" } },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1" }] },
      ])
    }).pipe(withProcessEnv({ AWS_BEARER_TOKEN_BEDROCK: "ambient-key" })),
  )

  it.effect("signs native Messages for the regional Bedrock Runtime endpoint", () =>
    Effect.gen(function* () {
      const model = AmazonBedrock.configure({
        auth: "sigv4",
        region: "us-west-2",
        credentials: { region: "us-east-1", accessKeyId: "AKIASIGNEXAMPLE", secretAccessKey: "test-secret" },
      }).messages("us.anthropic.claude-sonnet-4-6")
      const calls: Call[] = []
      const error = yield* LLMClient.generate(ai.request({ model, prompt: "Hi" })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            observe(calls, input).pipe(Effect.map(() => json(input, { message: "Access denied" }, { status: 403 }))),
          ),
        ),
        Effect.flip,
      )
      expect(error.reason.message).toContain("Access denied")
      expect(calls.map((call) => call.url)).toEqual([
        "https://bedrock-runtime.us-west-2.amazonaws.com/anthropic/v1/messages",
      ])
      expect(calls[0]?.headers.get("authorization")).toMatch(
        /Credential=AKIASIGNEXAMPLE\/\d+\/us-west-2\/bedrock\/aws4_request, SignedHeaders=[^,]*anthropic-version/,
      )
      expect(calls[0]?.headers.get("x-api-key")).toBeNull()
    }).pipe(withProcessEnv({ AWS_BEARER_TOKEN_BEDROCK: "ignored-in-sigv4-mode" })),
  )
})
