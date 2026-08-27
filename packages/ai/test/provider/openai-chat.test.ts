import { describe, expect } from "bun:test"
import { Effect, Ref, Schema, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import {
  HttpOptions,
  LLM,
  AIError,
  LLMEvent,
  LLMRequest,
  Message,
  LanguageModel,
  ToolCallPart,
  ToolDefinition,
  Usage,
} from "../../src/index.js"
import * as Azure from "../../src/providers/azure.js"
import * as OpenAI from "../../src/providers/openai.js"
import * as OpenAICompatible from "../../src/providers/openai-compatible.js"
import * as XAI from "../../src/providers/xai.js"
import * as OpenAIChat from "../../src/protocols/openai-chat.js"
import { ProviderShared } from "../../src/protocols/shared.js"
import { Auth, LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse, systemError, truncatedStream } from "../lib/http.js"
import { deltaChunk, usageChunk } from "../lib/openai-chunks.js"
import { sseEvents } from "../lib/sse.js"

const TargetJson = Schema.fromJsonString(Schema.Unknown)
const encodeJson = Schema.encodeSync(TargetJson)
const decodeJson = Schema.decodeUnknownSync(TargetJson)

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const request = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

describe("OpenAI Chat route", () => {
  it.effect("prepares OpenAI Chat payload", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(request)

      expect(prepared.body).toMatchObject({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        stream: true,
        stream_options: { include_usage: true },
        store: false,
        max_completion_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("lowers chronological system updates to escaped user wrappers in order", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Before."),
            Message.system("Treat <admin> & data literally."),
            Message.assistant("After."),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "user",
          content: "Before.\n<system-update>\nTreat &lt;admin&gt; &amp; data literally.\n</system-update>",
        },
        { role: "assistant", content: "After." },
      ])
    }),
  )

  it.effect("omits empty and whitespace-only assistant messages", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Before."),
            Message.assistant([]),
            Message.assistant(""),
            Message.assistant(" \n\t "),
            Message.assistant("After."),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: "Before." },
        { role: "assistant", content: "After." },
      ])
    }),
  )

  it.effect("replays canonical reasoning as OpenAI-compatible reasoning_content", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              { type: "reasoning", text: "thinking" },
              { type: "text", text: "Hello" },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([{ role: "assistant", content: "Hello", reasoning_content: "thinking" }])
    }),
  )

  it.effect("concatenates assistant text parts without adding separators", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              { type: "text", text: "Hello" },
              { type: "text", text: " world" },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([{ role: "assistant", content: "Hello world" }])
    }),
  )

  it.effect("writes reasoning to a configured custom field on every assistant message", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: LanguageModel.update(model, { compatibility: { reasoningField: "vendor_reasoning" } }),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "thinking",
                providerMetadata: { openai: { reasoningField: "reasoning" } },
              },
              { type: "text", text: "Hello" },
            ]),
            Message.assistant("Done"),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: "Hello", vendor_reasoning: "thinking" },
        { role: "assistant", content: "Done", vendor_reasoning: "" },
      ])
    }),
  )

  it.effect("preserves observed reasoning fields when reasoning is required", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: LanguageModel.update(model, { compatibility: { requireReasoning: true } }),
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "thinking",
                providerMetadata: { openai: { reasoningField: "reasoning_text" } },
              },
              { type: "text", text: "Hello" },
            ]),
            Message.assistant("Done"),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: "Hello", reasoning_text: "thinking" },
        { role: "assistant", content: "Done", reasoning_content: "" },
      ])
    }),
  )

  it.effect("omits empty configured reasoning fields when reasoning is explicitly optional", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: LanguageModel.update(model, {
            compatibility: { reasoningField: "reasoning_text", requireReasoning: false },
          }),
          messages: [
            Message.assistant([
              { type: "reasoning", text: "thinking" },
              { type: "text", text: "Hello" },
            ]),
            Message.assistant("Done"),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "assistant", content: "Hello", reasoning_text: "thinking" },
        { role: "assistant", content: "Done" },
      ])
    }),
  )

  it.effect("rejects reasoning fields that conflict with assistant message fields", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLM.request({
          model: LanguageModel.update(model, { compatibility: { reasoningField: "content" } }),
          messages: [Message.assistant([{ type: "reasoning", text: "thinking" }])],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("reserved field content")
    }),
  )

  it.effect("maps OpenAI provider options to Chat options", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).chat("gpt-4o-mini"),
          prompt: "think",
          providerOptions: { reasoningEffort: "max" },
        }),
      )

      expect(prepared.body.store).toBe(false)
      expect(prepared.body.reasoning_effort).toBe("max")
    }),
  )

  it.effect("maps the request prompt cache key", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenAICompatible.configure({
            baseURL: "https://api.compatible.test/v1",
            apiKey: "test",
          }).model("compatible-model"),
          prompt: "Hello",
          promptCacheKey: "session_123",
        }),
      )

      expect(prepared.body.prompt_cache_key).toBe("session_123")
    }),
  )

  it.effect("omits the prompt cache key when caching is disabled", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Hello",
          promptCacheKey: "session_123",
          cache: "none",
        }),
      )

      expect(prepared.body).not.toHaveProperty("prompt_cache_key")
    }),
  )

  it.effect("maps the xAI Chat prompt cache key to conversation affinity", () =>
    LLMClient.generate(
      LLM.request({
        model: XAI.configure({ apiKey: "test", baseURL: "https://api.x.ai/v1" }).chat("grok-4.5"),
        prompt: "Hello",
        promptCacheKey: "session_123",
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.headers.get("x-grok-conv-id")).toBe("session_123")
            const body = decodeJson(yield* Effect.promise(() => web.text()))
            expect(ProviderShared.isRecord(body) ? body.prompt_cache_key : undefined).toBe("session_123")
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("passes through custom OpenAI-compatible reasoning effort strings", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "think",
          providerOptions: { reasoningEffort: "experimental" },
        }),
      )

      expect(prepared.body.reasoning_effort).toBe("experimental")
    }),
  )

  it.effect("adds native query params to the Chat Completions URL", () =>
    LLMClient.generate(
      LLMRequest.update(request, {
        model: LanguageModel.update(model, {
          route: model.route.with({ endpoint: { query: { "api-version": "v1" } } }),
        }),
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.url).toBe("https://api.openai.test/v1/chat/completions?api-version=v1")
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("uses Azure api-key header for static OpenAI Chat keys", () =>
    LLMClient.generate(
      LLMRequest.update(request, {
        model: Azure.configure({
          baseURL: "https://opencode-test.openai.azure.com/openai/",
          apiKey: "azure-key",
          headers: { authorization: "Bearer stale" },
        }).chat("gpt-4o-mini"),
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.url).toBe("https://opencode-test.openai.azure.com/openai/v1/chat/completions?api-version=v1")
            expect(web.headers.get("api-key")).toBe("azure-key")
            expect(web.headers.get("authorization")).toBeNull()
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("applies serializable HTTP overlays after payload lowering", () =>
    LLMClient.generate(
      LLMRequest.update(request, {
        model: model.route
          .with({ auth: Auth.bearer("fresh-key"), headers: { authorization: "Bearer stale" } })
          .model({ id: model.id }),
        http: HttpOptions.make({
          body: { metadata: { source: "test" } },
          headers: { authorization: "Bearer request", "x-custom": "yes" },
          query: { debug: "1" },
        }),
      }),
    ).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            expect(web.url).toBe("https://api.openai.test/v1/chat/completions?debug=1")
            expect(web.headers.get("authorization")).toBe("Bearer fresh-key")
            expect(web.headers.get("x-custom")).toBe("yes")
            expect(decodeJson(input.text)).toMatchObject({
              stream: true,
              stream_options: { include_usage: true },
              metadata: { source: "test" },
            })
            return input.respond(sseEvents(deltaChunk({}, "stop")), {
              headers: { "content-type": "text/event-stream" },
            })
          }),
        ),
      ),
    ),
  )

  it.effect("prepares assistant tool-call and tool-result messages", () =>
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
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "What is the weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: encodeJson({ query: "weather" }) },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: encodeJson({ forecast: "sunny" }) },
        ],
        tools: [],
        stream: true,
        stream_options: { include_usage: true },
        store: false,
      })
    }),
  )

  it.effect("limits OpenAI and Azure Chat tool call IDs to 40 characters", () =>
    Effect.gen(function* () {
      const id = `call_${"a".repeat(48)}`
      const models = [
        model,
        Azure.configure({ baseURL: "https://opencode-test.openai.azure.com/openai/", apiKey: "test" }).chat("gpt-4o"),
      ]

      yield* Effect.forEach(models, (selected) =>
        Effect.gen(function* () {
          const prepared = yield* compileRequest(
            LLM.request({
              model: selected,
              messages: [
                Message.assistant([ToolCallPart.make({ id, name: "lookup", input: {} })]),
                Message.tool({ id, name: "lookup", result: "Sunny" }),
              ],
            }),
          )

          expect(prepared.body.messages).toMatchObject([
            { role: "assistant", tool_calls: [{ id: id.slice(0, 40) }] },
            { role: "tool", tool_call_id: id.slice(0, 40) },
          ])
        }),
      )
    }),
  )

  it.effect("preserves structured tool errors for the model", () =>
    Effect.gen(function* () {
      const error = { error: { type: "unknown", message: "Tool execution interrupted" } }
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "bash", input: {} })]),
            Message.tool({ id: "call_1", name: "bash", resultType: "error", result: error }),
          ],
        }),
      )

      expect(prepared.body.messages.at(-1)).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: ProviderShared.encodeJson(error),
      })
    }),
  )

  it.effect("continues image tool results as vision input without base64 text", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_image", name: "read", input: { path: "pixel.png" } })]),
            Message.tool({
              id: "call_image",
              name: "read",
              result: {
                type: "content",
                value: [
                  { type: "text", text: "Image read successfully" },
                  { type: "file", uri: "data:image/png;base64,AAECAw==", mime: "image/png", name: "pixel.png" },
                ],
              },
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_image",
              type: "function",
              function: { name: "read", arguments: encodeJson({ path: "pixel.png" }) },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_image", content: "Image read successfully" },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } }],
        },
      ])
      expect(JSON.stringify(prepared.body.messages)).not.toContain('"content":"AAECAw=="')
    }),
  )

  it.effect("bridges image tool results before their synthetic user message when required", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: LanguageModel.update(model, { compatibility: { requireAssistantAfterTool: true } }),
          messages: [
            Message.assistant([ToolCallPart.make({ id: "call_image", name: "read", input: {} })]),
            Message.tool({
              id: "call_image",
              name: "read",
              result: {
                type: "content",
                value: [{ type: "file", uri: "data:image/png;base64,AAECAw==", mime: "image/png", name: "pixel.png" }],
              },
            }),
          ],
        }),
      )

      expect(prepared.body.messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant", "user"])
      expect(prepared.body.messages[2]).toEqual({ role: "assistant", content: "Done." })
    }),
  )

  it.effect("orders parallel tool responses before one aggregated vision message", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              ToolCallPart.make({ id: "call_1", name: "read", input: {} }),
              ToolCallPart.make({ id: "call_2", name: "read", input: {} }),
            ]),
            Message.make({
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  id: "call_1",
                  name: "read",
                  result: {
                    type: "content",
                    value: [{ type: "file", uri: "data:image/png;base64,AAEC", mime: "image/png" }],
                  },
                },
                {
                  type: "tool-result",
                  id: "call_2",
                  name: "read",
                  result: {
                    type: "content",
                    value: [{ type: "file", uri: "data:image/jpeg;base64,/9j/", mime: "image/jpeg" }],
                  },
                },
              ],
            }),
          ],
        }),
      )
      expect(prepared.body.messages.slice(1)).toEqual([
        { role: "tool", tool_call_id: "call_1", content: "" },
        { role: "tool", tool_call_id: "call_2", content: "" },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAEC" } },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } },
          ],
        },
      ])
    }),
  )

  it.effect("aggregates consecutive tool images with a following system update", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.tool({
              id: "call_1",
              name: "read",
              result: {
                type: "content",
                value: [{ type: "file", uri: "data:image/png;base64,AAEC", mime: "image/png" }],
              },
            }),
            Message.tool({
              id: "call_2",
              name: "read",
              result: {
                type: "content",
                value: [{ type: "file", uri: "data:image/webp;base64,UklG", mime: "image/webp" }],
              },
            }),
            Message.system("Inspect both images."),
          ],
        }),
      )
      expect(prepared.body.messages).toEqual([
        { role: "tool", tool_call_id: "call_1", content: "" },
        { role: "tool", tool_call_id: "call_2", content: "" },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAEC" } },
            { type: "image_url", image_url: { url: "data:image/webp;base64,UklG" } },
            { type: "text", text: "<system-update>\nInspect both images.\n</system-update>" },
          ],
        },
      ])
    }),
  )

  it.effect("appends system updates without replacing multipart user content", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user({ type: "media", mediaType: "image/png", data: "AAEC" }),
            Message.system("Keep the image."),
          ],
        }),
      )
      expect(prepared.body.messages).toEqual([
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAEC" } },
            { type: "text", text: "<system-update>\nKeep the image.\n</system-update>" },
          ],
        },
      ])
    }),
  )

  it.effect("passes encoded image media through without local validation", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user([
              { type: "media", mediaType: "image/png", data: "not-base64" },
              { type: "media", mediaType: "image/png", data: "data:image/jpeg;base64,/9j/" },
              { type: "media", mediaType: "image/svg+xml", data: "PHN2Zz4=" },
            ]),
          ],
        }),
      )
      expect(prepared.body.messages).toEqual([
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,not-base64" } },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } },
            { type: "image_url", image_url: { url: "data:image/svg+xml;base64,PHN2Zz4=" } },
          ],
        },
      ])
    }),
  )

  it.effect("rejects non-image media that cannot be lowered", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLM.request({
          model,
          messages: [Message.user({ type: "media", mediaType: "audio/mpeg", data: "AAECAw==" })],
        }),
      ).pipe(Effect.flip)
      expect(error.message).toContain("OpenAI Chat does not support media type audio/mpeg")
    }),
  )

  it.effect("prepares raw and data URL image media as vision input", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_media",
          model,
          messages: [
            Message.user([
              { type: "media", mediaType: "image/png", data: "AAECAw==" },
              { type: "media", mediaType: "image/jpeg", data: "data:image/jpeg;base64,/9j/" },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } },
          ],
        },
      ])
    }),
  )

  it.effect("lowers reasoning-only assistant history", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_reasoning",
          model,
          messages: [Message.assistant({ type: "reasoning", text: "hidden" })],
        }),
      )

      expect(prepared.body.messages).toEqual([{ role: "assistant", content: "", reasoning_content: "hidden" }])
    }),
  )

  it.effect("parses text and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({ role: "assistant", content: "Hello" }),
        deltaChunk({ content: "!" }),
        deltaChunk({}, "stop"),
        usageChunk({
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
          prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 0 },
        }),
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))
      const usage = new Usage({
        inputTokens: 5,
        outputTokens: 2,
        nonCachedInputTokens: 2,
        cacheReadInputTokens: 1,
        cacheWriteInputTokens: 2,
        reasoningTokens: 0,
        totalTokens: 7,
        providerMetadata: {
          openai: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
            prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        },
      })

      expect(response.text).toBe("Hello!")
      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        { type: "text-start", id: "text-0" },
        { type: "text-delta", id: "text-0", text: "Hello" },
        { type: "text-delta", id: "text-0", text: "!" },
        { type: "text-end", id: "text-0" },
        {
          type: "step-finish",
          index: 0,
          reason: { normalized: "stop", raw: "stop" },
          usage,
          providerMetadata: undefined,
        },
        {
          type: "finish",
          reason: { normalized: "stop", raw: "stop" },
          usage,
        },
      ])
    }),
  )

  it.effect("preserves streamed refusals as ordinary assistant text", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              deltaChunk({ role: "assistant", refusal: "I can't" }),
              deltaChunk({ refusal: " help with that." }),
              deltaChunk({}, "stop"),
            ),
          ),
        ),
      )

      expect(response.text).toBe("I can't help with that.")
      expect(response.finishReason).toEqual({ normalized: "stop", raw: "stop" })
      expect(response.message.content).toEqual([{ type: "text", text: "I can't help with that." }])

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([{ role: "assistant", content: "I can't help with that." }])
    }),
  )

  it.effect("orders metadata-only reasoning before refusal output", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning_details: [] } }] },
              deltaChunk({ refusal: "I can't help with that." }),
              deltaChunk({}, "stop"),
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([
        { type: "reasoning", text: "", providerMetadata: { openai: { reasoningDetails: [] } } },
        {
          type: "text",
          text: "I can't help with that.",
        },
      ])
    }),
  )

  it.effect("joins content and refusal deltas into ordinary assistant text", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              deltaChunk({ refusal: "No." }),
              deltaChunk({ content: " Alternative." }),
              deltaChunk({ refusal: " Still no." }),
              deltaChunk({}, "stop"),
            ),
          ),
        ),
      )

      expect(response.text).toBe("No. Alternative. Still no.")
      expect(response.events.filter(LLMEvent.is.textStart).map((event) => event.id)).toEqual(["text-0"])
      expect(response.events.filter(LLMEvent.is.textEnd).map((event) => event.id)).toEqual(["text-0"])
    }),
  )

  it.effect("parses and replays OpenAI-compatible reasoning fields", () =>
    Effect.gen(function* () {
      const fields = ["reasoning_content", "reasoning", "reasoning_text"] as const
      for (const field of fields) {
        const response = yield* LLMClient.generate(request).pipe(
          Effect.provide(
            fixedResponse(
              sseEvents(
                { choices: [{ delta: { [field]: "thinking" } }] },
                { choices: [{ delta: { content: "Hello" } }] },
                { choices: [{ delta: {}, finish_reason: "stop" }] },
              ),
            ),
          ),
        )

        expect(response.reasoning).toBe("thinking")
        expect(response.text).toBe("Hello")
        expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
          openai: { reasoningField: field },
        })

        const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
        expect(replay.body.messages).toEqual([{ role: "assistant", content: "Hello", [field]: "thinking" }])
      }
    }),
  )

  it.effect("uses the configured provider metadata namespace for reasoning and usage", () =>
    Effect.gen(function* () {
      const selected = LanguageModel.update(model, {
        route: { ...model.route, providerMetadataKey: "vendor" },
      })
      const details = [{ type: "reasoning.text", text: "thinking", signature: "signed" }]
      const response = yield* LLMClient.generate(LLMRequest.update(request, { model: selected })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning: "thinking", reasoning_details: details } }] },
              deltaChunk({ content: "Hello" }),
              deltaChunk({}, "stop"),
              usageChunk({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }),
            ),
          ),
        ),
      )

      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        vendor: { reasoningField: "reasoning", reasoningDetails: details },
      })
      expect(response.usage?.providerMetadata).toEqual({
        vendor: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      })

      const replay = yield* compileRequest(LLM.request({ model: selected, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "Hello", reasoning: "thinking", reasoning_details: details },
      ])
    }),
  )

  it.effect("falls back to the selected provider for the metadata namespace", () =>
    Effect.gen(function* () {
      const compatible = model.route.with({ provider: "deepseek" }).model({ id: "deepseek-chat" })
      const selected = LanguageModel.update(compatible, {
        route: { ...compatible.route, providerMetadataKey: undefined },
      })
      const response = yield* LLMClient.generate(LLMRequest.update(request, { model: selected })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              deltaChunk({ reasoning_content: "thinking" }),
              deltaChunk({ content: "Hello" }),
              deltaChunk({}, "stop"),
              usageChunk({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }),
            ),
          ),
        ),
      )

      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        deepseek: { reasoningField: "reasoning_content" },
      })
      expect(response.usage?.providerMetadata).toEqual({
        deepseek: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      })

      const replay = yield* compileRequest(LLM.request({ model: selected, messages: [response.message] }))
      expect(replay.body.messages).toEqual([{ role: "assistant", content: "Hello", reasoning_content: "thinking" }])
    }),
  )

  it.effect("parses and replays a configured custom reasoning field", () =>
    Effect.gen(function* () {
      const custom = LanguageModel.update(model, { compatibility: { reasoningField: "vendor_reasoning" } })
      const response = yield* LLMClient.generate(LLMRequest.update(request, { model: custom })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { vendor_reasoning: "thinking" } }] },
              { choices: [{ delta: { content: "Hello" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("thinking")
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningField: "vendor_reasoning" },
      })

      const replay = yield* compileRequest(LLM.request({ model: custom, messages: [response.message] }))
      expect(replay.body.messages).toEqual([{ role: "assistant", content: "Hello", vendor_reasoning: "thinking" }])
    }),
  )

  it.effect("preserves and replays reasoning details alongside scalar reasoning", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "thinking", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.encrypted", data: "opaque", format: "anthropic-claude-v1", index: 1 },
      ]
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning: "thinking", reasoning_details: [details[0]] } }] },
              { choices: [{ delta: { reasoning_details: [details[1]] } }] },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        { index: 0, id: "call_1", function: { name: "lookup", arguments: '{"query":"weather"}' } },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("thinking")
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningField: "reasoning", reasoningDetails: details },
      })

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        {
          role: "assistant",
          content: null,
          reasoning: "thinking",
          reasoning_details: details,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"query":"weather"}' },
            },
          ],
        },
      ])
    }),
  )

  it.effect("uses reasoning details as display fallback without inventing a scalar replay field", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.summary", summary: "thinking", format: "openai-responses-v1", index: 0 },
        { type: "reasoning.encrypted", data: "opaque", format: "openai-responses-v1", index: 1 },
      ]
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning_details: [details[0]] } }] },
              { choices: [{ delta: { reasoning_details: [details[1]] } }] },
              { choices: [{ delta: { content: "Hello" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("thinking")
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningDetails: details },
      })

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([{ role: "assistant", content: "Hello", reasoning_details: details }])
    }),
  )

  it.effect("preserves unknown reasoning details while using scalar display text", () =>
    Effect.gen(function* () {
      const details = [{ type: "reasoning.future", format: "provider-v2", state: { opaque: true } }]
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning: "thinking", reasoning_details: details } }] },
              { choices: [{ delta: { content: "Hello" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("thinking")
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningField: "reasoning", reasoningDetails: details },
      })

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "Hello", reasoning: "thinking", reasoning_details: details },
      ])
    }),
  )

  it.effect("uses scalar display text for signature-only reasoning details", () =>
    Effect.gen(function* () {
      const details = [{ type: "reasoning.text", signature: "signed", format: "provider-v2", index: 0 }]
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning: "thinking", reasoning_details: details } }] },
              { choices: [{ delta: { content: "Hello" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("thinking")
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningField: "reasoning", reasoningDetails: details },
      })
    }),
  )

  it.effect("preserves scalar reasoning after content starts", () =>
    Effect.gen(function* () {
      const details = [{ type: "reasoning.text", text: "detail", format: "unknown", index: 0 }]
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning_details: details } }] },
              { choices: [{ delta: { content: "Hello" } }] },
              { choices: [{ delta: { reasoning: "scalar" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("detailscalar")
      expect(response.events.filter(LLMEvent.is.reasoningStart)).toHaveLength(2)
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toHaveLength(2)
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningField: "reasoning", reasoningDetails: details },
      })
    }),
  )

  it.effect("preserves an explicitly empty reasoning details array", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning_details: [] } }] },
              { choices: [{ delta: { content: "Hello" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("")
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningDetails: [] },
      })

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([{ role: "assistant", content: "Hello", reasoning_details: [] }])
    }),
  )

  it.effect("attaches signature-only details that arrive after content", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "thinking", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed", format: "anthropic-claude-v1", index: 0 },
      ]
      const merged = [
        {
          type: "reasoning.text",
          text: "thinking",
          signature: "signed",
          format: "anthropic-claude-v1",
          index: 0,
        },
      ]
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning: "thinking", reasoning_details: [details[0]] } }] },
              { choices: [{ delta: { content: "Hello" } }] },
              { choices: [{ delta: { reasoning_details: [details[1]] } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("thinking")
      expect(response.message.content.filter((part) => part.type === "reasoning")).toHaveLength(1)
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        openai: { reasoningField: "reasoning", reasoningDetails: merged },
      })
      expect(response.events.filter(LLMEvent.is.reasoningStart)).toHaveLength(1)
      expect(response.events.filter(LLMEvent.is.reasoningDelta)).toHaveLength(1)
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toHaveLength(1)
      expect(response.events.filter(LLMEvent.is.reasoningEnd).at(-1)?.providerMetadata).toEqual({
        openai: { reasoningField: "reasoning", reasoningDetails: merged },
      })
      expect(response.events.findIndex(LLMEvent.is.reasoningEnd)).toBeLessThan(
        response.events.findIndex(LLMEvent.is.textStart),
      )

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "Hello", reasoning: "thinking", reasoning_details: merged },
      ])
    }),
  )

  it.effect("preserves metadata-only reasoning when the stream ends", () =>
    Effect.gen(function* () {
      const details = [{ type: "reasoning.encrypted", data: "opaque", format: "openai-responses-v1", index: 0 }]
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning_details: details } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([
        { type: "reasoning", text: "", providerMetadata: { openai: { reasoningDetails: details } } },
      ])
      expect(response.events.filter(LLMEvent.is.reasoningStart)).toHaveLength(1)
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toHaveLength(1)

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([{ role: "assistant", content: "", reasoning_details: details }])
    }),
  )

  it.effect("flushes details-only display reasoning when the stream ends", () =>
    Effect.gen(function* () {
      const details = [{ type: "reasoning.summary", summary: "summary", format: "openai-responses-v1", index: 0 }]
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { choices: [{ delta: { reasoning_details: details } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("summary")
      expect(response.message.content).toEqual([
        { type: "reasoning", text: "summary", providerMetadata: { openai: { reasoningDetails: details } } },
      ])
    }),
  )

  it.effect("replays details from multiple reasoning parts in order", () =>
    Effect.gen(function* () {
      const first = { type: "reasoning.text", text: "first", signature: "signed-0", index: 0 }
      const second = { type: "reasoning.text", text: "second", signature: "signed-1", index: 1 }
      const replay = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "first",
                providerMetadata: { openai: { reasoningDetails: [first] } },
              },
              {
                type: "reasoning",
                text: "second",
                providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: [second] } },
              },
            ]),
          ],
        }),
      )

      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "", reasoning: "firstsecond", reasoning_details: [first, second] },
      ])
    }),
  )

  it.effect("retains scalar replay for mixed structured reasoning parts", () =>
    Effect.gen(function* () {
      const detail = { type: "reasoning.encrypted", data: "opaque", index: 0 }
      const replay = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "A",
                providerMetadata: { openai: { reasoningDetails: [detail] } },
              },
              { type: "reasoning", text: "B" },
            ]),
          ],
        }),
      )

      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "", reasoning_content: "AB", reasoning_details: [detail] },
      ])
    }),
  )

  it.effect("replays native scalar reasoning alongside native details", () =>
    Effect.gen(function* () {
      const details = [{ type: "reasoning.encrypted", data: "opaque", index: 0 }]
      const replay = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.make({
              role: "assistant",
              content: [{ type: "reasoning", text: "thinking" }],
              native: { openaiCompatible: { reasoning_content: "thinking", reasoning_details: details } },
            }),
          ],
        }),
      )

      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "", reasoning_content: "thinking", reasoning_details: details },
      ])
    }),
  )

  it.effect("assembles streamed tool call input", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({
          role: "assistant",
          tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: '{"query"' } }],
        }),
        deltaChunk({ tool_calls: [{ index: 0, function: { arguments: ':"weather"}' } }] }),
        deltaChunk({}, "tool_calls"),
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        { type: "tool-input-start", id: "call_1", name: "lookup", providerMetadata: undefined },
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
          reason: { normalized: "tool-calls", raw: "tool_calls" },
          usage: undefined,
          providerMetadata: undefined,
        },
        { type: "finish", reason: { normalized: "tool-calls", raw: "tool_calls" }, usage: undefined },
      ])
    }),
  )

  it.effect("ignores empty identity fields on later tool call deltas", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({
          tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{" } }],
        }),
        deltaChunk({
          tool_calls: [{ index: 0, id: "", function: { name: "", arguments: '\"query\":\"weather\"}' } }],
        }),
        deltaChunk({}, "tool_calls"),
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      expect(response.toolCalls).toMatchObject([{ id: "call_1", name: "lookup", input: { query: "weather" } }])
    }),
  )

  it.effect("buffers tool call deltas until the function name arrives", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({
          tool_calls: [{ index: 0, id: "call_1", function: { arguments: "{" } }],
        }),
        deltaChunk({
          tool_calls: [{ index: 0, function: { name: "lookup", arguments: '\"query\":' } }],
        }),
        deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '\"weather\"}' } }] }),
        deltaChunk({}, "tool_calls"),
      )
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      expect(response.toolCalls).toMatchObject([{ id: "call_1", name: "lookup", input: { query: "weather" } }])
    }),
  )

  it.effect("fails when a buffered tool call never receives a function name", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({
          tool_calls: [{ index: 0, id: "call_1", function: { arguments: "{}" } }],
        }),
        deltaChunk({}, "tool_calls"),
      )
      const error = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)), Effect.flip)

      expect(error.message).toContain("OpenAI Chat tool call delta is missing id or name")
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      if (error.reason._tag !== "InvalidProviderOutput") return
      expect(decodeJson(error.reason.body ?? "")).toMatchObject({
        choices: [{ finish_reason: "tool_calls" }],
      })
    }),
  )

  it.effect("finalizes a streamed tool call when the provider ends without a finish reason", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({
          role: "assistant",
          tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: '{"query"' } }],
        }),
        deltaChunk({ tool_calls: [{ index: 0, function: { arguments: ':"weather"}' } }] }),
      )
      const input = LLMRequest.update(request, {
        model: LanguageModel.update(model, { compatibility: { requireFinishReason: false } }),
        tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
      })
      const response = yield* LLMClient.generate(input).pipe(Effect.provide(fixedResponse(body)))

      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        { type: "tool-input-start", id: "call_1", name: "lookup", providerMetadata: undefined },
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
          reason: { normalized: "tool-calls" },
          usage: undefined,
          providerMetadata: undefined,
        },
        { type: "finish", reason: { normalized: "tool-calls" }, usage: undefined },
      ])
    }),
  )

  it.effect("fails on malformed stream events", () =>
    Effect.gen(function* () {
      const body = sseEvents(deltaChunk({ content: 123 }))
      const error = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)), Effect.flip)

      expect(error.message).toContain("Invalid openai/openai-chat stream event")
    }),
  )

  it.effect("surfaces transport errors that occur mid-stream", () =>
    Effect.gen(function* () {
      const layer = truncatedStream(
        [`data: ${JSON.stringify(deltaChunk({ role: "assistant", content: "Hello" }))}\n\n`],
        systemError("ECONNRESET", "socket closed unexpectedly"),
      )
      const events = yield* Ref.make<ReadonlyArray<LLMEvent>>([])
      const error = yield* LLMClient.stream(request).pipe(
        Stream.tap((event) => Ref.update(events, (current) => [...current, event])),
        Stream.runDrain,
        Effect.provide(layer),
        Effect.flip,
      )

      expect((yield* Ref.get(events)).some((event) => event.type === "text-delta")).toBeTrue()
      expect(error.message).toBe("ECONNRESET: socket closed unexpectedly")
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        transport: "http",
        operation: "read",
        code: "ECONNRESET",
        url: "https://api.openai.test/v1/chat/completions",
      })
    }),
  )

  it.effect("surfaces transport errors before the first stream frame", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(truncatedStream([], systemError("ECONNRESET", "socket closed before output"))),
        Effect.flip,
      )

      expect(error.message).toBe("ECONNRESET: socket closed before output")
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        transport: "http",
        operation: "read",
        code: "ECONNRESET",
      })
    }),
  )

  it.effect("fails HTTP provider errors before stream parsing", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse('{"error":{"message":"Bad request","type":"invalid_request_error"}}', {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        ),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(AIError)
      expect(error).toMatchObject({ reason: { _tag: "InvalidRequest" }, message: "Bad request" })
    }),
  )

  it.effect("short-circuits the upstream stream when the consumer takes a prefix", () =>
    Effect.gen(function* () {
      // The body has more chunks than we'll consume. If `Stream.take(1)` did
      // not interrupt the upstream HTTP body the test would hang waiting for
      // the rest of the stream to drain.
      const body = sseEvents(
        deltaChunk({ role: "assistant", content: "Hello" }),
        deltaChunk({ content: " world" }),
        deltaChunk({}, "stop"),
      )

      const events = Array.from(
        yield* LLMClient.stream(request).pipe(Stream.take(1), Stream.runCollect, Effect.provide(fixedResponse(body))),
      )
      expect(events.map((event) => event.type)).toEqual(["step-start"])
    }),
  )
})
