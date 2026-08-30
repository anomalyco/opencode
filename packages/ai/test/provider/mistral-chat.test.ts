import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMEvent, Message, ToolDefinition } from "../../src/index.js"
import { Mistral } from "../../src/providers/index.js"
import { MistralChat } from "../../src/protocols/index.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const model = Mistral.configure({ apiKey: "fixture" }).model("mistral-large-latest")
const request = LLM.request({ model, prompt: "Hello" })
const chunk = (delta: object, finishReason: string | null = null, usage?: object) => ({
  choices: [{ delta, finish_reason: finishReason }],
  usage,
})

describe("Mistral Chat", () => {
  test("exposes native provider and protocol identities", async () => {
    const entrypoint = await import("@opencode-ai/ai/providers/mistral")

    expect(Mistral.id).toBe("mistral")
    expect(MistralChat.protocol.id).toBe("mistral-chat")
    expect(Mistral.route).toMatchObject({
      id: "mistral-chat",
      provider: "mistral",
      providerMetadataKey: "mistral",
      protocol: "mistral-chat",
    })
    expect(Mistral.route.endpoint).toMatchObject({
      baseURL: "https://api.mistral.ai/v1",
      path: "/chat/completions",
    })
    expect(entrypoint.model).toBeFunction()
  })

  it.effect("lowers native messages, media, tool choice, options, and replay IDs", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          system: "Initial",
          messages: [
            Message.system("Updated"),
            Message.user([
              { type: "text", text: "Inspect" },
              { type: "media", mediaType: "image/png", data: "aW1hZ2U=" },
              { type: "media", mediaType: "application/pdf", data: "cGRm" },
            ]),
            Message.assistant([
              { type: "reasoning", text: "Think" },
              { type: "text", text: "Calling" },
              { type: "tool-call", id: "call.same-prefix-1", name: "lookup", input: { city: "Paris" } },
              { type: "tool-call", id: "call.same-prefix-2", name: "other", input: {} },
            ]),
            Message.tool({ id: "call.same-prefix-1", name: "lookup", result: { ok: true } }),
          ],
          tools: [
            ToolDefinition.make({ name: "lookup", description: "Look up a city", inputSchema: { type: "object" } }),
            ToolDefinition.make({ name: "other", description: "Other operation", inputSchema: { type: "object" } }),
          ],
          toolChoice: "lookup",
          promptCacheKey: "session-1",
          generation: {
            maxTokens: 64,
            seed: 7,
            temperature: 0.2,
            topP: 0.8,
            frequencyPenalty: 0.1,
            presencePenalty: 0.3,
            stop: ["done"],
          },
          providerOptions: {
            safePrompt: true,
            documentImageLimit: 3,
            documentPageLimit: 8,
            parallelToolCalls: false,
            reasoningEffort: "high",
          },
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "mistral-large-latest",
        tools: [{ function: { name: "lookup", strict: false } }, { function: { name: "other", strict: false } }],
        tool_choice: { type: "function", function: { name: "lookup" } },
        stream: true,
        max_tokens: 64,
        random_seed: 7,
        temperature: 0.2,
        top_p: 0.8,
        frequency_penalty: 0.1,
        presence_penalty: 0.3,
        stop: ["done"],
        prompt_cache_key: "session-1",
        safe_prompt: true,
        document_image_limit: 3,
        document_page_limit: 8,
        parallel_tool_calls: false,
        reasoning_effort: "high",
      })
      expect(prepared.body.messages.slice(0, 4)).toMatchObject([
        { role: "system", content: "Initial" },
        { role: "user", content: "<system-update>\nUpdated\n</system-update>" },
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect" },
            { type: "image_url", image_url: "data:image/png;base64,aW1hZ2U=" },
            { type: "document_url", document_url: "data:application/pdf;base64,cGRm" },
          ],
        },
        {
          role: "assistant",
          content: "ThinkCalling",
        },
      ])
      const assistant = prepared.body.messages[3]
      const toolResult = prepared.body.messages[4]
      expect(assistant?.role).toBe("assistant")
      expect(toolResult?.role).toBe("tool")
      if (assistant?.role !== "assistant" || toolResult?.role !== "tool") return
      const ids = assistant.tool_calls?.map((tool) => tool.id) ?? []
      expect(ids).toHaveLength(2)
      expect(ids[0]).toMatch(/^[A-Za-z0-9]{9}$/)
      expect(ids[1]).toMatch(/^[A-Za-z0-9]{9}$/)
      expect(ids[0]).not.toBe(ids[1])
      expect(toolResult.tool_call_id).toBe(ids[0])
      expect(toolResult.name).toBe("lookup")
    }),
  )

  it.effect("preserves valid replay IDs", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant({ type: "tool-call", id: "Ab12Cd34E", name: "lookup", input: {} }),
            Message.tool({ id: "Ab12Cd34E", name: "lookup", result: "ok" }),
          ],
        }),
      )
      expect(prepared.body.messages).toMatchObject([
        { tool_calls: [{ id: "Ab12Cd34E" }] },
        { tool_call_id: "Ab12Cd34E" },
      ])
    }),
  )

  it.effect("applies trailing prefix, cache, and reasoning options without changing earlier assistants", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          promptCacheKey: "common-key",
          messages: [Message.assistant("Earlier"), Message.user("Continue"), Message.assistant("Prefix")],
          providerOptions: { promptCacheKey: "native-key", promptMode: "reasoning" },
        }),
      )
      expect(prepared.body.prompt_cache_key).toBe("native-key")
      expect(prepared.body.prompt_mode).toBe("reasoning")
      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: "Earlier" },
        { role: "user", content: "Continue" },
        { role: "assistant", content: "Prefix", prefix: true },
      ])

      const uncached = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Hello",
          promptCacheKey: "common-key",
          cache: "none",
          providerOptions: { promptCacheKey: "native-key" },
        }),
      )
      expect(uncached.body.prompt_cache_key).toBeUndefined()

      const longKey = "cache-key-".repeat(10)
      const unbounded = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Hello",
          promptCacheKey: longKey,
        }),
      )
      expect(unbounded.body.prompt_cache_key).toBe(longKey)

      const conflict = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Hello",
          providerOptions: { reasoningEffort: "high", promptMode: "reasoning" },
        }),
      ).pipe(Effect.flip)
      expect(conflict.message).toContain("mutually exclusive")
    }),
  )

  it.effect("omits empty assistant history unless it carries a tool call", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant(" \n "),
            Message.assistant({ type: "reasoning", text: "\t" }),
            Message.assistant({ type: "tool-call", id: "Ab12Cd34E", name: "lookup", input: {} }),
          ],
        }),
      )
      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "Ab12Cd34E", type: "function", function: { name: "lookup", arguments: "{}" } }],
        },
      ])
    }),
  )

  it.effect("preserves remote media URLs and structured tool-result media", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user({
              type: "media",
              mediaType: "image/png",
              data: "https://assets.example.test/input.png",
            }),
            Message.tool({
              id: "Ab12Cd34E",
              name: "inspect",
              resultType: "content",
              result: [
                { type: "text", text: "Result" },
                { type: "file", mime: "image/jpeg", uri: "https://assets.example.test/output.jpg" },
                { type: "file", mime: "application/pdf", uri: "cGRm" },
              ],
            }),
          ],
        }),
      )
      expect(prepared.body.messages).toEqual([
        {
          role: "user",
          content: [{ type: "image_url", image_url: "https://assets.example.test/input.png" }],
        },
        {
          role: "tool",
          tool_call_id: "Ab12Cd34E",
          name: "inspect",
          content: [
            { type: "text", text: "Result" },
            { type: "image_url", image_url: "https://assets.example.test/output.jpg" },
            { type: "document_url", document_url: "data:application/pdf;base64,cGRm" },
          ],
        },
      ])
    }),
  )

  it.effect("concatenates text-only user and tool content without separators", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user([
              { type: "text", text: "first" },
              { type: "text", text: "second" },
            ]),
            Message.tool({
              id: "Ab12Cd34E",
              name: "lookup",
              resultType: "content",
              result: [
                { type: "text", text: "third" },
                { type: "text", text: "fourth" },
              ],
            }),
          ],
        }),
      )
      expect(prepared.body.messages).toEqual([
        { role: "user", content: "firstsecond" },
        { role: "tool", tool_call_id: "Ab12Cd34E", name: "lookup", content: "thirdfourth" },
      ])
    }),
  )

  it.effect("streams ordered thinking and text and replays native thinking metadata", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({ content: [{ type: "thinking", thinking: [], marker: "empty" }] }),
              chunk({ content: [{ type: "thinking", thinking: [{ type: "text", text: "Consider" }] }] }),
              chunk({ content: [{ type: "text", text: "Answer" }] }),
              chunk({}, "stop"),
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("Consider")
      expect(response.text).toBe("Answer")
      expect(response.message.content).toEqual([
        {
          type: "reasoning",
          text: "Consider",
          providerMetadata: {
            mistral: {
              thinking: {
                type: "thinking",
                thinking: [{ type: "text", text: "Consider" }],
                marker: "empty",
              },
            },
          },
        },
        { type: "text", text: "Answer" },
      ])

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: [{ type: "text", text: "Consider" }],
              marker: "empty",
            },
            { type: "text", text: "Answer" },
          ],
          prefix: true,
        },
      ])
    }),
  )

  it.effect("replays metadata-only native thinking", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(chunk({ content: [{ type: "thinking", thinking: [], marker: "opaque" }] }), chunk({}, "stop")),
          ),
        ),
      )
      expect(response.message.content).toEqual([
        {
          type: "reasoning",
          text: "",
          providerMetadata: {
            mistral: { thinking: { type: "thinking", thinking: [], marker: "opaque" } },
          },
        },
      ])

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: [], marker: "opaque" }],
          prefix: true,
        },
      ])
    }),
  )

  it.effect("merges indexed argument fragments with missing continuation identity", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({
                tool_calls: [{ index: 0, id: "Ab12Cd34E", function: { name: "lookup", arguments: '{"city":' } }],
              }),
              chunk({ tool_calls: [{ index: 0, function: { name: "", arguments: '"Paris"}' } }] }),
              chunk({}, "tool_calls"),
            ),
          ),
        ),
      )

      expect(response.message.content).toContainEqual({
        type: "tool-call",
        id: "Ab12Cd34E",
        name: "lookup",
        input: { city: "Paris" },
      })
      expect(
        response.events.filter(
          (event) =>
            LLMEvent.is.toolInputStart(event) ||
            LLMEvent.is.toolInputDelta(event) ||
            LLMEvent.is.toolInputEnd(event) ||
            LLMEvent.is.toolCall(event),
        ),
      ).toEqual([
        { type: "tool-input-start", id: "Ab12Cd34E", name: "lookup", providerMetadata: undefined },
        {
          type: "tool-input-delta",
          id: "Ab12Cd34E",
          name: "lookup",
          text: '{"city":',
          input: {},
        },
        {
          type: "tool-input-delta",
          id: "Ab12Cd34E",
          name: "lookup",
          text: '"Paris"}',
          input: { city: "Paris" },
        },
        { type: "tool-input-end", id: "Ab12Cd34E", name: "lookup", providerMetadata: undefined },
        {
          type: "tool-call",
          id: "Ab12Cd34E",
          name: "lookup",
          input: { city: "Paris" },
          providerExecuted: undefined,
          providerMetadata: undefined,
        },
      ])
      expect(response.events.filter(LLMEvent.is.toolCall)).toHaveLength(1)
    }),
  )

  it.effect("normalizes stop to tool calls when a hosted model emits indexed tool fragments", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({
                tool_calls: [
                  {
                    index: 0,
                    id: "chatcmpl-tool-8cc4d8f9f07b298a",
                    function: { name: "lookup", arguments: '{"city":"' },
                  },
                ],
              }),
              chunk({ tool_calls: [{ index: 0, function: { name: "", arguments: 'Paris"}' } }] }),
              chunk({}, "stop"),
            ),
          ),
        ),
      )

      expect(response.finishReason).toEqual({ normalized: "tool-calls", raw: "stop" })
      expect(response.toolCalls).toMatchObject([{ name: "lookup", input: { city: "Paris" } }])
      expect(response.events.filter(LLMEvent.is.toolCall)).toHaveLength(1)
    }),
  )

  it.effect("generates a stable ID when the first indexed fragment has null identity", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({
                tool_calls: [{ index: 0, id: null, function: { name: "lookup", arguments: { city: "Paris" } } }],
              }),
              chunk({}, "tool_calls"),
            ),
          ),
        ),
      )
      const call = response.message.content.find((part) => part.type === "tool-call")
      expect(call?.id).toMatch(/^[A-Za-z0-9]{9}$/)
      expect(call).toMatchObject({ name: "lookup", input: { city: "Paris" } })
    }),
  )

  it.effect("generates distinct IDs for parallel null and literal-null identities", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({
                tool_calls: [
                  { index: 0, id: null, function: { name: "first", arguments: {} } },
                  { index: 1, id: "null", function: { name: "second", arguments: {} } },
                ],
              }),
              chunk({}, "tool_calls"),
            ),
          ),
        ),
      )
      const calls = response.message.content.filter((part) => part.type === "tool-call")
      expect(calls).toHaveLength(2)
      expect(calls[0]?.id).toMatch(/^[A-Za-z0-9]{9}$/)
      expect(calls[1]?.id).toMatch(/^[A-Za-z0-9]{9}$/)
      expect(calls[0]?.id).not.toBe(calls[1]?.id)
    }),
  )

  it.effect("keeps parallel indexed calls independent", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({
                tool_calls: [
                  { index: 0, id: "Ab12Cd34E", function: { name: "first", arguments: '{"n":' } },
                  { index: 1, id: "Fg56Hi78J", function: { name: "second", arguments: '{"n":' } },
                ],
              }),
              chunk({
                tool_calls: [
                  { index: 0, function: { arguments: "1}" } },
                  { index: 1, function: { arguments: "2}" } },
                ],
              }),
              chunk({}, "tool_calls"),
            ),
          ),
        ),
      )
      expect(response.message.content.filter((part) => part.type === "tool-call")).toEqual([
        { type: "tool-call", id: "Ab12Cd34E", name: "first", input: { n: 1 } },
        { type: "tool-call", id: "Fg56Hi78J", name: "second", input: { n: 2 } },
      ])
    }),
  )

  it.effect("correlates parallel identity-less fragments by batch position", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({
                tool_calls: [
                  { function: { name: "first", arguments: '{"n":' } },
                  { function: { name: "second", arguments: '{"n":' } },
                ],
              }),
              chunk({
                tool_calls: [{ function: { arguments: "1}" } }, { function: { arguments: "2}" } }],
              }),
              chunk({}, "tool_calls"),
            ),
          ),
        ),
      )
      expect(response.message.content.filter((part) => part.type === "tool-call")).toMatchObject([
        { name: "first", input: { n: 1 } },
        { name: "second", input: { n: 2 } },
      ])
    }),
  )

  it.effect("maps usage variants and clamps cache reads", () =>
    Effect.gen(function* () {
      for (const usage of [
        { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, num_cached_tokens: 9 },
        { prompt_tokens: 5, completion_tokens: 2, prompt_token_details: { cached_tokens: 2 } },
        { prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3 } },
      ]) {
        const response = yield* LLMClient.generate(request).pipe(
          Effect.provide(fixedResponse(sseEvents(chunk({}, "stop", usage)))),
        )
        expect(response.usage).toMatchObject({
          inputTokens: 5,
          outputTokens: 2,
          totalTokens: 7,
        })
        expect(response.usage?.cacheReadInputTokens).toBe(
          Math.min(
            5,
            usage.num_cached_tokens ??
              usage.prompt_token_details?.cached_tokens ??
              usage.prompt_tokens_details?.cached_tokens ??
              0,
          ),
        )
      }
    }),
  )

  it.effect("maps finish reasons and does not finalize truncated tool calls", () =>
    Effect.gen(function* () {
      for (const [raw, normalized] of [
        ["stop", "stop"],
        ["model_length", "length"],
        ["tool_calls", "tool-calls"],
        ["error", "error"],
        ["future_reason", "unknown"],
      ] as const) {
        const response = yield* LLMClient.generate(request).pipe(
          Effect.provide(fixedResponse(sseEvents(chunk({}, raw)))),
        )
        expect(response.finishReason).toEqual({ normalized, raw })
      }

      const truncated = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({
                tool_calls: [{ index: 0, id: "Ab12Cd34E", function: { name: "lookup", arguments: '{"city":' } }],
              }),
              chunk({}, "length"),
            ),
          ),
        ),
      )
      expect(truncated.finishReason).toEqual({ normalized: "length", raw: "length" })
      expect(truncated.events.some(LLMEvent.is.toolCall)).toBe(false)
      expect(truncated.events.some(LLMEvent.is.toolInputEnd)).toBe(false)
    }),
  )

  it.effect("ignores non-text output parts and rejects invalid stream endings", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({ content: null }),
              chunk({
                content: [
                  { type: "reference", reference_ids: [1] },
                  { type: "image_url", image_url: "https://example.test/image.png" },
                  { type: "text", text: "Answer" },
                ],
              }),
              chunk({}, "stop"),
            ),
          ),
        ),
      )
      expect(response.text).toBe("Answer")

      const missingFinish = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents(chunk({ content: "partial" })))),
        Effect.flip,
      )
      expect(missingFinish.message).toContain("without finish_reason")

      const lateContent = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(sseEvents(chunk({}, "stop"), chunk({ content: [{ type: "text", text: "late" }] }))),
        ),
        Effect.flip,
      )
      expect(lateContent.message).toContain("content after the finish reason")
    }),
  )

  it.effect("uses environment bearer auth and custom package settings", () =>
    LLMClient.generate(
      LLM.request({
        model: Mistral.model("fixture-model", {
          baseURL: "https://mistral.test/v1",
          headers: { "x-app": "test" },
          body: { service_tier: "priority" },
          providerOptions: { safePrompt: true },
        }),
        prompt: "Hello",
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.url).toBe("https://mistral.test/v1/chat/completions")
            expect(web.headers.get("authorization")).toBe("Bearer secret")
            expect(web.headers.get("x-app")).toBe("test")
            expect(input.text).toContain('"service_tier":"priority"')
            return input.respond(sseEvents(chunk({}, "stop")), { headers: { "content-type": "text/event-stream" } })
          }),
        ),
      ),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { MISTRAL_API_KEY: "secret" } }))),
    ),
  )
})
