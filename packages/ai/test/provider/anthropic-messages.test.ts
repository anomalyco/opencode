import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { CacheHint, LLM, AIError, LLMRequest, Message, ToolCallPart, ToolDefinition, Usage } from "../../src/index.js"
import { Auth, LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages.js"
import { continuationRequest, nativeAnthropicMessagesContinuation } from "../continuation-scenarios.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents, sseNamedEvent, sseRaw } from "../lib/sse.js"

const model = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

const opus48 = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-opus-4-8" })

const compileUnsignedReasoning = (model: LLMRequest["model"]) =>
  compileRequest(
    LLM.request({
      model,
      messages: [Message.assistant([{ type: "reasoning", text: "unsigned reasoning" }])],
      cache: "none",
    }),
  )

const request = LLM.request({
  id: "req_1",
  model,
  system: { type: "text", text: "You are concise.", cache: new CacheHint({ type: "ephemeral" }) },
  prompt: "Say hello.",
  // This fixture predates the `cache: "auto"` default; pin the policy off so
  // existing wire-shape assertions only see the manual hint on the system part.
  cache: "none",
  generation: { maxTokens: 20, temperature: 0 },
})

type AnthropicToolResult = Extract<
  AnthropicMessages.AnthropicMessagesBody["messages"][number]["content"][number],
  { readonly type: "tool_result" }
>

const expectToolResult = (body: AnthropicMessages.AnthropicMessagesBody): AnthropicToolResult => {
  const result = body.messages
    .flatMap((message) => (message.role === "user" ? message.content : []))
    .find((block): block is AnthropicToolResult => block.type === "tool_result")
  expect(result).toBeDefined()
  return result!
}

describe("Anthropic Messages route", () => {
  it.effect("prepares Anthropic Messages target", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(request)

      expect(prepared.body).toEqual({
        model: "claude-sonnet-4-5",
        system: [{ type: "text", text: "You are concise.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "Say hello." }] }],
        stream: true,
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("lowers adaptive thinking settings with effort", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: {
            thinking: { type: "adaptive", display: "summarized" },
            effort: "low",
          },
        }),
      )

      expect(prepared.body).toMatchObject({
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "low" },
      })
    }),
  )

  it.effect("normalizes enabled and disabled thinking settings", () =>
    Effect.gen(function* () {
      const enabled = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: { thinking: { type: "enabled", budgetTokens: 1_024 } },
        }),
      )
      const legacy = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: { thinking: { type: "enabled", budget_tokens: 2_048 } },
        }),
      )
      const disabled = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: { thinking: { type: "disabled" } },
        }),
      )

      expect(enabled.body.thinking).toEqual({ type: "enabled", budget_tokens: 1_024 })
      expect(legacy.body.thinking).toEqual({ type: "enabled", budget_tokens: 2_048 })
      expect(disabled.body.thinking).toEqual({ type: "disabled" })
    }),
  )

  it.effect("rejects enabled thinking without a budget", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: { thinking: { type: "enabled" } },
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("Anthropic thinking provider option requires budgetTokens")
    }),
  )

  it.effect("lowers chronological system updates natively for Claude Opus 4.8 with cache hints", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: opus48,
          messages: [
            Message.user("Before."),
            Message.system([{ type: "text", text: "Operator update.", cache: new CacheHint({ type: "ephemeral" }) }]),
            Message.assistant("After."),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Before." }] },
        {
          role: "system",
          content: [{ type: "text", text: "Operator update.", cache_control: { type: "ephemeral" } }],
        },
        { role: "assistant", content: [{ type: "text", text: "After." }] },
      ])
    }),
  )

  it.effect("supports native chronological system updates on documented and later Claude family versions", () =>
    Effect.gen(function* () {
      const ids = [
        "claude-opus-4-8",
        "claude-opus-5-1",
        "claude-sonnet-5",
        "claude-haiku-5-1",
        "claude-fable-6",
        "anthropic/claude-mythos-7.2",
      ]

      const prepared = yield* Effect.forEach(ids, (id) =>
        compileRequest(
          LLM.request({
            model: AnthropicMessages.route
              .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
              .model({ id }),
            messages: [Message.user("Before."), Message.system("Update."), Message.assistant("After.")],
            cache: "none",
          }),
        ),
      )

      expect(prepared.map((item) => item.body.messages[1]?.role)).toEqual(ids.map(() => "system"))
    }),
  )

  it.effect("lowers chronological system updates to wrapped user text for unsupported Anthropic models", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Before."),
            Message.system("Treat </system-update> literally."),
            Message.assistant("After."),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "Before." },
            { type: "text", text: "<system-update>\nTreat &lt;/system-update&gt; literally.\n</system-update>" },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "After." }] },
      ])
    }),
  )

  it.effect("does not infer native system update support for older or undocumented Claude families", () =>
    Effect.gen(function* () {
      const ids = [
        "claude-opus-4-7",
        "claude-opus-4-20250514",
        "claude-sonnet-4-9",
        "claude-haiku-4-9",
        "custom-model-7",
      ]

      const prepared = yield* Effect.forEach(ids, (id) =>
        compileRequest(
          LLM.request({
            model: AnthropicMessages.route
              .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
              .model({ id }),
            messages: [Message.user("Before."), Message.system("Update."), Message.assistant("After.")],
            cache: "none",
          }),
        ),
      )

      expect(prepared.map((item) => item.body.messages.some((message) => message.role === "system"))).toEqual(
        ids.map(() => false),
      )
    }),
  )

  it.effect("rejects non-text chronological system update content before send", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLM.request({
          model: opus48,
          messages: [
            Message.user("Before."),
            Message.make({ role: "system", content: { type: "media", mediaType: "image/png", data: "AAECAw==" } }),
          ],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("Anthropic Messages system messages only support text content for now")
    }),
  )

  it.effect("falls back for unsupported native chronological system update placement", () =>
    Effect.gen(function* () {
      expect(
        (yield* compileRequest(
          LLM.request({
            model: opus48,
            messages: [Message.assistant("Plain."), Message.system("After plain assistant.")],
            cache: "none",
          }),
        )).body.messages,
      ).toEqual([
        { role: "assistant", content: [{ type: "text", text: "Plain." }] },
        {
          role: "user",
          content: [{ type: "text", text: "<system-update>\nAfter plain assistant.\n</system-update>" }],
        },
      ])
      expect(
        (yield* compileRequest(LLM.request({ model: opus48, messages: [Message.system("First.")], cache: "none" })))
          .body.messages,
      ).toEqual([{ role: "user", content: [{ type: "text", text: "<system-update>\nFirst.\n</system-update>" }] }])
      expect(
        (yield* compileRequest(
          LLM.request({
            model: opus48,
            messages: [Message.user("Before."), Message.system("One."), Message.system("Two.")],
            cache: "none",
          }),
        )).body.messages,
      ).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "Before." },
            { type: "text", text: "<system-update>\nOne.\n</system-update>" },
            { type: "text", text: "<system-update>\nTwo.\n</system-update>" },
          ],
        },
      ])
    }),
  )

  it.effect("rejects a system update between a local tool call and its result", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLM.request({
          model: opus48,
          messages: [
            Message.user("Use the tool."),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
            Message.system("Too early."),
            Message.tool({ id: "call_1", name: "lookup", result: "Done." }),
          ],
          cache: "none",
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("system updates cannot split a local tool call from its tool result")
    }),
  )

  it.effect("prepares tool call and tool result messages", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result",
          model,
          messages: [
            Message.user("What is the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body).toEqual({
        model: "claude-sonnet-4-5",
        messages: [
          { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { query: "weather" } }],
          },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"forecast":"sunny"}' }] },
        ],
        stream: true,
        max_tokens: 32_000,
      })
    }),
  )

  it.effect("scrubs outbound tool call IDs without truncating them", () =>
    Effect.gen(function* () {
      const id = `functions.lookup:1|${"x".repeat(64)}`
      const scrubbed = `functions_lookup_1_${"x".repeat(64)}`
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id, name: "lookup", input: {} })]),
            Message.tool({ id, name: "lookup", result: "done" }),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { role: "assistant", content: [{ type: "tool_use", id: scrubbed, name: "lookup", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: scrubbed }] },
      ])
      expect(scrubbed.length).toBeGreaterThan(64)
    }),
  )

  it.effect("batches parallel tool results into one Anthropic user message", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Check both cities."),
            Message.assistant([
              { type: "text", text: "I'll check both." },
              ToolCallPart.make({ id: "call_paris", name: "weather", input: { city: "Paris" } }),
              ToolCallPart.make({ id: "call_london", name: "weather", input: { city: "London" } }),
            ]),
            Message.tool({ id: "call_paris", name: "weather", result: { temperature: 22 } }),
            Message.tool({ id: "call_london", name: "weather", result: { temperature: 18 } }),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { role: "user", content: [{ type: "text", text: "Check both cities." }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll check both." },
            { type: "tool_use", id: "call_paris", name: "weather", input: { city: "Paris" } },
            { type: "tool_use", id: "call_london", name: "weather", input: { city: "London" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_paris", content: '{"temperature":22}' },
            { type: "tool_result", tool_use_id: "call_london", content: '{"temperature":18}' },
          ],
        },
      ])
      expect(prepared.body.messages).toHaveLength(3)
    }),
  )

  it.effect("keeps tools and sends tool_choice none", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_choice_none",
          model,
          tools: [{ name: "lookup", description: "Look things up", inputSchema: { type: "object", properties: {} } }],
          messages: [
            Message.user("What is the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
          toolChoice: "none",
          cache: "none",
        }),
      )

      expect(prepared.body.tools).toEqual([
        {
          name: "lookup",
          description: "Look things up",
          input_schema: { type: "object", properties: {} },
        },
      ])
      expect(prepared.body.tool_choice).toEqual({ type: "none" })
    }),
  )

  // Regression: read tool results must stay structured so base64 media data is
  // not JSON-stringified into `tool_result.content`.
  it.effect("lowers media tool-result content as structured blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_image",
          model,
          messages: [
            Message.user("Show me the screenshot."),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "read", input: { filePath: "shot.png" } })]),
            Message.tool({
              id: "call_1",
              name: "read",
              resultType: "content",
              result: [
                { type: "text", text: "Image read successfully" },
                { type: "file", uri: "data:image/png;base64,AAECAw==", mime: "image/png" },
                { type: "file", uri: "data:application/pdf;base64,JVBERi0xLjQ=", mime: "application/pdf" },
              ],
            }),
          ],
          cache: "none",
        }),
      )

      expect(expectToolResult(prepared.body).content).toEqual([
        { type: "text", text: "Image read successfully" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAECAw==" } },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQ=" } },
      ])
    }),
  )

  it.effect("lowers single-image tool-result content as a structured image block", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_image_only",
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "screenshot", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "screenshot",
              resultType: "content",
              result: [{ type: "file", uri: "data:image/jpeg;base64,/9j/AA==", mime: "image/jpeg" }],
            }),
          ],
          cache: "none",
        }),
      )

      expect(expectToolResult(prepared.body).content).toEqual([
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/AA==" } },
      ])
    }),
  )

  it.effect("rejects tool-result media that cannot be lowered", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLM.request({
          id: "req_tool_result_unsupported_media",
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "fetch", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "fetch",
              resultType: "content",
              result: [{ type: "file", uri: "data:audio/mpeg;base64,AAECAw==", mime: "audio/mpeg" }],
            }),
          ],
          cache: "none",
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("Anthropic Messages does not support media type audio/mpeg")
    }),
  )

  it.effect("prepares the composed native continuation request", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        continuationRequest({
          id: "req_native_continuation_anthropic",
          model,
          features: nativeAnthropicMessagesContinuation,
        }),
      )

      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "You are concise. Continue from the provided history." }],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is shown here?" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "AAECAw==" } },
            ],
          },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "I inspected the previous turn.", signature: "sig_continuation_1" },
              { type: "text", text: "It shows a small test image." },
            ],
          },
          { role: "user", content: [{ type: "text", text: "Check the weather in Paris before continuing." }] },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "call_weather_1", name: "get_weather", input: { city: "Paris" } }],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call_weather_1", content: '{"temperature":22}' }],
          },
          { role: "assistant", content: [{ type: "text", text: "Paris is 22 degrees." }] },
          { role: "user", content: [{ type: "text", text: "Continue from this conversation in one short sentence." }] },
        ],
      })
      expect(prepared.body.tools).toEqual([expect.objectContaining({ name: "get_weather" })])
    }),
  )

  it.effect("lowers preserved Anthropic reasoning signature metadata", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              { type: "reasoning", text: "thinking", providerMetadata: { anthropic: { signature: "sig_1" } } },
            ]),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "thinking", signature: "sig_1" }] }],
      })
    }),
  )

  it.effect("demotes unsigned reasoning when signatures are required", () =>
    Effect.gen(function* () {
      const prepared = yield* compileUnsignedReasoning(model)

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: [{ type: "text", text: "unsigned reasoning" }] },
      ])
    }),
  )

  it.effect("infers empty-signature compatibility across Kimi providers", () =>
    Effect.gen(function* () {
      const coding = AnthropicMessages.route.with({
        provider: "kimi-for-coding",
        endpoint: { baseURL: "https://compatible.test/v1/" },
        auth: Auth.header("x-api-key", "test"),
      })
      const moonshot = AnthropicMessages.route
        .with({
          provider: "moonshotai",
          endpoint: { baseURL: "https://api.moonshot.ai/anthropic" },
          auth: Auth.bearer("test"),
        })
        .model({ id: "kimi-k2.6" })
      const codingPrepared = yield* compileUnsignedReasoning(coding.model({ id: "k3" }))
      const moonshotPrepared = yield* compileUnsignedReasoning(moonshot)

      expect(codingPrepared.body.messages).toEqual([
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "unsigned reasoning", signature: "" }],
        },
      ])
      expect(moonshotPrepared.body.messages).toEqual([
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "unsigned reasoning", signature: "" }],
        },
      ])
    }),
  )

  it.effect("lets an explicit signature requirement override inference", () =>
    Effect.gen(function* () {
      const compatible = AnthropicMessages.route
        .with({
          provider: "kimi-for-coding",
          endpoint: { baseURL: "https://api.kimi.com/coding/v1/" },
          auth: Auth.header("x-api-key", "test"),
        })
        .model({ id: "k3", compatibility: { requireSignature: true } })
      const prepared = yield* compileUnsignedReasoning(compatible)

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: [{ type: "text", text: "unsigned reasoning" }] },
      ])
    }),
  )

  it.effect("round-trips redacted thinking as redacted_thinking blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              { type: "reasoning", text: "", providerMetadata: { anthropic: { redactedData: "opaque_1" } } },
              { type: "reasoning", text: "visible", providerMetadata: { anthropic: { signature: "sig_1" } } },
            ]),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        messages: [
          {
            role: "assistant",
            content: [
              { type: "redacted_thinking", data: "opaque_1" },
              { type: "thinking", thinking: "visible", signature: "sig_1" },
            ],
          },
        ],
      })
    }),
  )

  it.effect("parses text, reasoning, and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "!" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "thinking" } },
        { type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "sig_1" } },
        { type: "content_block_stop", index: 1 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: "\n\nHuman:" },
          usage: { output_tokens: 2 },
        },
        { type: "message_stop" },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      expect(response.text).toBe("Hello!")
      expect(response.reasoning).toBe("thinking")
      expect(response.usage).toMatchObject({
        inputTokens: 6,
        outputTokens: 2,
        nonCachedInputTokens: 5,
        cacheReadInputTokens: 1,
        totalTokens: 8,
      })
      expect(response.events.find((event) => event.type === "reasoning-end")).toMatchObject({
        providerMetadata: { anthropic: { signature: "sig_1" } },
      })
      expect(response.events.find((event) => event.type === "reasoning-delta" && event.text === "")).toBeUndefined()
      expect(response.message.content).toEqual([
        { type: "text", text: "Hello!" },
        { type: "reasoning", text: "thinking", providerMetadata: { anthropic: { signature: "sig_1" } } },
      ])
      expect(response.events.at(-1)).toMatchObject({
        type: "finish",
        reason: { normalized: "stop", raw: "end_turn" },
        providerMetadata: { anthropic: { stopSequence: "\n\nHuman:" } },
      })
    }),
  )

  it.effect("requires message_stop before completing a streamed message", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
              { type: "content_block_stop", index: 0 },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
            ),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        classification: "incomplete-stream",
        message: "The provider response ended unexpectedly.",
      })
    }),
  )

  it.effect("ignores unknown named SSE events", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseRaw(
              sseNamedEvent("message_start", {
                type: "message_start",
                message: { usage: { input_tokens: 5 } },
              }),
              sseNamedEvent("proxy.stats", "not json"),
              sseNamedEvent("content_block_start", {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              }),
              sseNamedEvent("content_block_delta", {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "Hello" },
              }),
              sseNamedEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
              sseNamedEvent("message_delta", {
                type: "message_delta",
                delta: { stop_reason: "end_turn" },
                usage: { output_tokens: 1 },
              }),
              sseNamedEvent("message_stop", { type: "message_stop" }),
              sseNamedEvent("proxy.done", "still not json"),
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([{ type: "text", text: "Hello" }])
      expect(response.finishReason).toEqual({ normalized: "stop", raw: "end_turn" })
    }),
  )

  it.effect("ignores unknown content block and delta variants", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              { type: "future_event", content_block: 42, delta: 42 },
              { type: "content_block_start", index: 0, content_block: { type: "future_block", text: 42 } },
              { type: "content_block_delta", index: 0, delta: { text: "ignored" } },
              { type: "content_block_delta", index: 0, delta: { type: "future_delta", text: 42 } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hidden" } },
              { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hidden" } },
              { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "hidden" } },
              { type: "content_block_stop", index: 0 },
              { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
              { type: "content_block_stop", index: 1 },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([{ type: "text", text: "Hello" }])
      expect(response.finishReason).toEqual({ normalized: "stop", raw: "end_turn" })
    }),
  )

  it.effect("rejects malformed recognized content block variants", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: 42 } },
            ),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        message: "Invalid anthropic/anthropic-messages stream event",
      })
    }),
  )

  it.effect("rejects malformed recognized content delta variants", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: 42 } },
            ),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        message: "Invalid anthropic/anthropic-messages stream event",
      })
    }),
  )

  it.effect("rejects malformed payloads on unrelated stream events", () =>
    Effect.gen(function* () {
      const events = [
        { type: "message_start", message: { usage: { input_tokens: 1 } }, delta: 42 },
        { type: "content_block_start", index: 0 },
        { type: "content_block_delta", index: 0 },
        { type: "content_block_stop", index: 0, content_block: { type: "text", text: 42 } },
        { type: "message_delta" },
        { type: "message_delta", delta: { stop_reason: 42 } },
        { type: "message_stop", delta: { text: 42 } },
        { type: "error", error: { type: "overloaded_error", message: "busy" }, content_block: 42 },
      ]

      yield* Effect.forEach(events, (event) =>
        Effect.gen(function* () {
          const error = yield* LLMClient.generate(request).pipe(
            Effect.provide(fixedResponse(sseEvents(event))),
            Effect.flip,
          )

          expect(error.reason).toMatchObject({
            _tag: "InvalidProviderOutput",
            message: "Invalid anthropic/anthropic-messages stream event",
          })
        }),
      )
    }),
  )

  it.effect("rejects malformed recognized SSE events", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseRaw(sseNamedEvent("message_start", "[DONE]")))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        message: "Invalid anthropic/anthropic-messages stream event",
      })
    }),
  )

  it.effect("maps nullable input tokens and preserves unknown Anthropic usage fields", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "message_start",
                message: {
                  usage: {
                    input_tokens: 5,
                    cache_read_input_tokens: 2,
                    service_tier: "standard",
                    cache_creation: { ephemeral_5m_input_tokens: 1 },
                    server_tool_use: { web_search_requests: 1, start_counter: 2 },
                    output_tokens_details: { thinking_tokens: 3, start_detail: "preserved" },
                  },
                },
              },
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn" },
                usage: {
                  input_tokens: null,
                  output_tokens: 8,
                  server_tool_use: { web_search_requests: 2, terminal_counter: 3 },
                  output_tokens_details: { terminal_detail: "preserved" },
                  future_terminal: { requests: 4 },
                },
              },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.usage).toMatchObject({
        inputTokens: 7,
        outputTokens: 8,
        reasoningTokens: 3,
        totalTokens: 15,
        providerMetadata: {
          anthropic: {
            input_tokens: null,
            cache_read_input_tokens: 2,
            service_tier: "standard",
            cache_creation: { ephemeral_5m_input_tokens: 1 },
            server_tool_use: { web_search_requests: 2, start_counter: 2, terminal_counter: 3 },
            output_tokens: 8,
            output_tokens_details: {
              thinking_tokens: 3,
              start_detail: "preserved",
              terminal_detail: "preserved",
            },
            future_terminal: { requests: 4 },
          },
        },
      })
    }),
  )

  it.effect("round-trips omitted thinking carried only by a signature delta", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: "", signature: "" },
              },
              { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_1" } },
              { type: "content_block_stop", index: 0 },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([
        { type: "reasoning", text: "", providerMetadata: { anthropic: { signature: "sig_1" } } },
      ])

      const prepared = yield* compileRequest(LLM.request({ model, messages: [response.message], cache: "none" }))
      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig_1" }] },
      ])
    }),
  )

  it.effect("retains a thinking signature supplied in content_block_start", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: "", signature: "sig_1" },
              },
              { type: "content_block_stop", index: 0 },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([
        { type: "reasoning", text: "", providerMetadata: { anthropic: { signature: "sig_1" } } },
      ])
      expect(response.events.find((event) => event.type === "reasoning-end")).toMatchObject({
        providerMetadata: { anthropic: { signature: "sig_1" } },
      })
    }),
  )

  it.effect("retains complete tool input from content_block_start", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "call_1", name: "lookup", input: { query: "weather" } },
              },
              { type: "content_block_stop", index: 0 },
              { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.toolCalls).toMatchObject([{ id: "call_1", name: "lookup", input: { query: "weather" } }])
    }),
  )

  it.effect("retains empty text blocks", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_stop", index: 0 },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([{ type: "text", text: "" }])
    }),
  )

  it.effect("parses redacted thinking into empty reasoning with redactedData metadata", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "opaque_1" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      expect(response.events.find((event) => event.type === "reasoning-start")).toMatchObject({
        providerMetadata: { anthropic: { redactedData: "opaque_1" } },
      })
      expect(response.message.content).toEqual([
        { type: "reasoning", text: "", providerMetadata: { anthropic: { redactedData: "opaque_1" } } },
        { type: "text", text: "Hello" },
      ])
    }),
  )

  it.effect("round-trips streamed redacted thinking with tool use into a continuation request", () =>
    Effect.gen(function* () {
      // Anthropic types `redacted_thinking.data` as an opaque string. Its
      // contents are provider-owned and must be replayed without inspection.
      const redactedData = "cmVkYWN0ZWQtdGhpbmtpbmc="
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "redacted_thinking", data: redactedData },
              },
              { type: "content_block_stop", index: 0 },
              {
                type: "content_block_start",
                index: 1,
                content_block: { type: "tool_use", id: "call_1", name: "lookup" },
              },
              {
                type: "content_block_delta",
                index: 1,
                delta: { type: "input_json_delta", partial_json: '{"query":"weather"}' },
              },
              { type: "content_block_stop", index: 1 },
              { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Say hello."),
            response.message,
            Message.tool({ id: "call_1", name: "lookup", result: "sunny", resultType: "text" }),
          ],
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Say hello." }] },
        {
          role: "assistant",
          content: [
            { type: "redacted_thinking", data: redactedData },
            { type: "tool_use", id: "call_1", name: "lookup", input: { query: "weather" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: "sunny",
              is_error: undefined,
              cache_control: undefined,
            },
          ],
        },
      ])
    }),
  )

  it.effect("maps context-window truncation to length", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "message_delta",
                delta: { stop_reason: "model_context_window_exceeded" },
                usage: { output_tokens: 1 },
              },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.finishReason).toEqual({ normalized: "length", raw: "model_context_window_exceeded" })
    }),
  )

  it.effect("preserves pause_turn while normalizing it to stop", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              { type: "message_delta", delta: { stop_reason: "pause_turn" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.finishReason).toEqual({ normalized: "stop", raw: "pause_turn" })
    }),
  )

  it.effect("assembles streamed tool call input", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "lookup" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query"' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"weather"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))
      const usage = new Usage({
        inputTokens: 5,
        outputTokens: 1,
        nonCachedInputTokens: 5,
        cacheReadInputTokens: undefined,
        cacheWriteInputTokens: undefined,
        totalTokens: 6,
        providerMetadata: { anthropic: { input_tokens: 5, output_tokens: 1 } },
      })

      expect(response.toolCalls).toEqual([
        {
          type: "tool-call",
          id: "call_1",
          name: "lookup",
          input: { query: "weather" },
          providerExecuted: undefined,
          providerMetadata: undefined,
        },
      ])
      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        { type: "tool-input-start", id: "call_1", name: "lookup" },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"', input: {} },
        {
          type: "tool-input-delta",
          id: "call_1",
          name: "lookup",
          text: ':"weather"}',
          input: { query: "weather" },
        },
        { type: "tool-input-end", id: "call_1", name: "lookup", providerMetadata: undefined },
        {
          type: "tool-call",
          id: "call_1",
          name: "lookup",
          input: { query: "weather" },
          providerExecuted: undefined,
          providerMetadata: undefined,
        },
        {
          type: "step-finish",
          index: 0,
          reason: { normalized: "tool-calls", raw: "tool_use" },
          usage,
          providerMetadata: undefined,
        },
        {
          type: "finish",
          reason: { normalized: "tool-calls", raw: "tool_use" },
          providerMetadata: undefined,
          usage,
        },
      ])
    }),
  )

  it.effect("ignores tool input deltas without a matching tool start", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
              {
                type: "content_block_delta",
                index: 1,
                delta: { type: "input_json_delta", partial_json: '{"query":"orphaned"}' },
              },
              { type: "content_block_stop", index: 0 },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.text).toBe("Hello")
      expect(response.toolCalls).toEqual([])
      expect(response.finishReason).toEqual({ normalized: "stop", raw: "end_turn" })
    }),
  )

  it.effect("settles pending tool calls at message_stop", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "call_1", name: "lookup" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "input_json_delta", partial_json: '{"query":"weather"}' },
              },
              { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.toolCalls).toMatchObject([{ id: "call_1", name: "lookup", input: { query: "weather" } }])
      expect(response.finishReason).toEqual({ normalized: "tool-calls", raw: "tool_use" })
    }),
  )

  it.effect("assembles and persists multiple tool calls from one Anthropic response", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "call_paris", name: "weather", input: {} },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "input_json_delta", partial_json: '{"city":"Paris"}' },
              },
              { type: "content_block_stop", index: 0 },
              {
                type: "content_block_start",
                index: 1,
                content_block: { type: "tool_use", id: "call_london", name: "weather", input: {} },
              },
              {
                type: "content_block_delta",
                index: 1,
                delta: { type: "input_json_delta", partial_json: '{"city":"London"}' },
              },
              { type: "content_block_stop", index: 1 },
              { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
              { type: "message_stop" },
            ),
          ),
        ),
      )

      expect(response.toolCalls).toMatchObject([
        { id: "call_paris", name: "weather", input: { city: "Paris" } },
        { id: "call_london", name: "weather", input: { city: "London" } },
      ])
      expect(response.message.content).toMatchObject([
        { type: "tool-call", id: "call_paris", name: "weather", input: { city: "Paris" } },
        { type: "tool-call", id: "call_london", name: "weather", input: { city: "London" } },
      ])
      expect(response.finishReason).toEqual({ normalized: "tool-calls", raw: "tool_use" })
    }),
  )

  it.effect("keeps malformed server tool input terminal", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "server_tool_use", id: "call_1", name: "web_search" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"query":"partial' },
        },
        { type: "content_block_stop", index: 0 },
      )

      const error = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)), Effect.flip)

      expect(error).toBeInstanceOf(AIError)
      expect(error.message).toContain("Invalid JSON input for anthropic-messages tool call web_search")
    }),
  )

  it.effect("fails with a typed provider error for stream error frames", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(sseEvents({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "ProviderInternal", message: "overloaded_error: Overloaded" })
    }),
  )

  it.effect("classifies prompt-too-long provider errors", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              type: "error",
              error: { type: "invalid_request_error", message: "prompt is too long: 210000 tokens" },
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        message: "invalid_request_error: prompt is too long: 210000 tokens",
        classification: "context-overflow",
      })
    }),
  )

  it.effect("falls back to error type when no message is present", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "error", error: { type: "overloaded_error", message: "" } }))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "ProviderInternal", message: "overloaded_error" })
    }),
  )

  it.effect("falls back to a stable default when error payload is absent", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ type: "error" }))),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "UnknownProvider", message: "Anthropic Messages stream error" })
    }),
  )

  it.effect("fails HTTP provider errors before stream parsing", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse('{"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}', {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        ),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", message: "Bad request" })
    }),
  )

  it.effect("decodes server_tool_use + web_search_tool_result as provider-executed events", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "server_tool_use", id: "srvtoolu_abc", name: "web_search" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"query":"effect 4"}' },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_abc",
            content: [{ type: "web_search_result", url: "https://example.com", title: "Example" }],
          },
        },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Found it." } },
        { type: "content_block_stop", index: 2 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } },
        { type: "message_stop" },
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [
            ToolDefinition.make({ name: "web_search", description: "Web search", inputSchema: { type: "object" } }),
          ],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      const toolCall = response.events.find((event) => event.type === "tool-call")
      expect(toolCall).toEqual({
        type: "tool-call",
        id: "srvtoolu_abc",
        name: "web_search",
        input: { query: "effect 4" },
        providerExecuted: true,
      })
      const toolResult = response.events.find((event) => event.type === "tool-result")
      expect(toolResult).toEqual({
        type: "tool-result",
        id: "srvtoolu_abc",
        name: "web_search",
        result: { type: "json", value: [{ type: "web_search_result", url: "https://example.com", title: "Example" }] },
        providerExecuted: true,
        // The complete payload rides in provider metadata as irreducible replay
        // state for later stateless requests.
        providerMetadata: {
          anthropic: {
            blockType: "web_search_tool_result",
            result: [{ type: "web_search_result", url: "https://example.com", title: "Example" }],
          },
        },
      })
      expect(response.text).toBe("Found it.")
      expect(response.events.at(-1)).toMatchObject({
        type: "finish",
        reason: { normalized: "stop", raw: "end_turn" },
      })
    }),
  )

  it.effect("decodes web_search_tool_result_error as provider-executed error result", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "server_tool_use", id: "srvtoolu_x", name: "web_search" },
        },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"q"}' } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_x",
            content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
          },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [
            ToolDefinition.make({ name: "web_search", description: "Web search", inputSchema: { type: "object" } }),
          ],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      const toolResult = response.events.find((event) => event.type === "tool-result")
      expect(toolResult).toMatchObject({
        type: "tool-result",
        id: "srvtoolu_x",
        name: "web_search",
        result: { type: "error" },
        providerExecuted: true,
      })
    }),
  )

  it.effect("round-trips provider-executed assistant content into server tool blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_round_trip",
          model,
          messages: [
            Message.user("Search for something."),
            Message.assistant([
              {
                type: "tool-call",
                id: "srvtoolu.abc",
                name: "web_search",
                input: { query: "effect 4" },
                providerExecuted: true,
              },
              {
                type: "tool-result",
                id: "srvtoolu.abc",
                name: "web_search",
                result: { type: "json", value: [{ url: "https://example.com" }] },
                providerExecuted: true,
              },
              { type: "text", text: "Found it." },
            ]),
            Message.user("Thanks."),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        messages: [
          { role: "user", content: [{ type: "text", text: "Search for something." }] },
          {
            role: "assistant",
            content: [
              { type: "server_tool_use", id: "srvtoolu_abc", name: "web_search", input: { query: "effect 4" } },
              {
                type: "web_search_tool_result",
                tool_use_id: "srvtoolu_abc",
                content: [{ url: "https://example.com" }],
              },
              { type: "text", text: "Found it." },
            ],
          },
          { role: "user", content: [{ type: "text", text: "Thanks." }] },
        ],
      })
    }),
  )

  it.effect("rejects round-trip for unknown server tool names", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLM.request({
          id: "req_unknown_server_tool",
          model,
          messages: [
            Message.assistant([
              {
                type: "tool-result",
                id: "srvtoolu_abc",
                name: "future_server_tool",
                result: { type: "json", value: {} },
                providerExecuted: true,
              },
            ]),
          ],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("future_server_tool")
    }),
  )

  it.effect("continues a conversation with user media content", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          id: "req_media",
          model,
          messages: [
            Message.user([
              { type: "text", text: "What is in this image?" },
              { type: "media", mediaType: "image/png", data: "AAECAw==" },
              { type: "media", mediaType: "application/pdf", data: "JVBERi0xLjQ=", filename: "report.pdf" },
            ]),
          ],
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(yield* Effect.promise(() => web.json())).toMatchObject({
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: "What is in this image?" },
                      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAECAw==" } },
                      {
                        type: "document",
                        source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQ=" },
                      },
                    ],
                  },
                ],
              })
              return input.respond(
                sseEvents(
                  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "An image." } },
                  { type: "content_block_stop", index: 0 },
                  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
                  { type: "message_stop" },
                ),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("An image.")
    }),
  )

  it.effect("maps ttlSeconds >= 3600 to cache_control ttl: '1h'", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          system: { type: "text", text: "system", cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }) },
          prompt: "hi",
        }),
      )

      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "system", cache_control: { type: "ephemeral", ttl: "1h" } }],
      })
    }),
  )

  it.effect("emits cache_control on tool definitions and tool-result blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          tools: [
            {
              name: "lookup",
              description: "lookup tool",
              inputSchema: { type: "object", properties: {} },
              cache: new CacheHint({ type: "ephemeral" }),
            },
          ],
          messages: [
            Message.user("What's the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "lookup",
              result: { temp: 72 },
              cache: new CacheHint({ type: "ephemeral" }),
            }),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "lookup", cache_control: { type: "ephemeral" } }],
        messages: [
          { role: "user", content: [{ type: "text", text: "What's the weather?" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup" }] },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call_1", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("drops cache_control breakpoints past the 4-per-request cap", () =>
    Effect.gen(function* () {
      const hint = new CacheHint({ type: "ephemeral" })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          system: [
            { type: "text", text: "a", cache: hint },
            { type: "text", text: "b", cache: hint },
            { type: "text", text: "c", cache: hint },
            { type: "text", text: "d", cache: hint },
            { type: "text", text: "e", cache: hint },
            { type: "text", text: "f", cache: hint },
          ],
          prompt: "hi",
        }),
      )

      const system = (prepared.body as { system: Array<{ cache_control?: unknown }> }).system
      const marked = system.filter((part) => part.cache_control !== undefined)
      expect(marked).toHaveLength(4)
      expect(system[4]?.cache_control).toBeUndefined()
      expect(system[5]?.cache_control).toBeUndefined()
    }),
  )

  it.effect("spends breakpoint budget on tools before system before messages", () =>
    Effect.gen(function* () {
      const hint = new CacheHint({ type: "ephemeral" })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          tools: [
            {
              name: "t1",
              description: "t1",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
            {
              name: "t2",
              description: "t2",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
            {
              name: "t3",
              description: "t3",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
            {
              name: "t4",
              description: "t4",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
          ],
          system: [{ type: "text", text: "system-tail", cache: hint }],
          messages: [Message.user([{ type: "text", text: "message-tail", cache: hint }])],
        }),
      )

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      expect(body.tools.every((t) => t.cache_control !== undefined)).toBe(true)
      expect(body.system[0]?.cache_control).toBeUndefined()
      expect(body.messages[0]?.content[0]?.cache_control).toBeUndefined()
    }),
  )
})
