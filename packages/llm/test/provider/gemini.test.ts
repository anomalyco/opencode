import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMError, Message, ToolCallPart, Usage } from "../../src"
import { Auth, LLMClient } from "../../src/route"
import * as Gemini from "../../src/protocols/gemini"
import { ProviderShared } from "../../src/protocols/shared"
import { it } from "../lib/effect"
import { fixedResponse } from "../lib/http"
import { sseEvents, sseRaw } from "../lib/sse"

const model = Gemini.route
  .with({
    endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
    auth: Auth.header("x-goog-api-key", "test"),
  })
  .model({ id: "gemini-2.5-flash" })

const request = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

describe("Gemini route", () => {
  it.effect("prepares Gemini target", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(request)

      expect(prepared.body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
        systemInstruction: { parts: [{ text: "You are concise." }] },
        generationConfig: { maxOutputTokens: 20, temperature: 0 },
      })
    }),
  )

  it.effect("lowers chronological system updates to wrapped user text in order", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Gemini.GeminiBody>(
        LLM.request({
          model,
          messages: [Message.user("Before."), Message.system("Update."), Message.assistant("After.")],
        }),
      )

      expect(prepared.body.contents).toEqual([
        { role: "user", parts: [{ text: "Before." }, { text: "<system-update>\nUpdate.\n</system-update>" }] },
        { role: "model", parts: [{ text: "After." }] },
      ])
    }),
  )

  it.effect("prepares multimodal user input and tool history", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_tool_result",
          model,
          tools: [
            {
              name: "lookup",
              description: "Lookup data",
              inputSchema: { type: "object", properties: { query: { type: "string" } } },
            },
          ],
          toolChoice: { type: "tool", name: "lookup" },
          messages: [
            Message.user([
              { type: "text", text: "What is in this image?" },
              { type: "media", mediaType: "image/png", data: "AAECAw==" },
            ]),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.body).toEqual({
        contents: [
          {
            role: "user",
            parts: [{ text: "What is in this image?" }, { inlineData: { mimeType: "image/png", data: "AAECAw==" } }],
          },
          {
            role: "model",
            parts: [{ functionCall: { name: "lookup", args: { query: "weather" } } }],
          },
          {
            role: "user",
            parts: [
              { functionResponse: { name: "lookup", response: { name: "lookup", content: '{"forecast":"sunny"}' } } },
            ],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookup",
                description: "Lookup data",
                parameters: { type: "object", properties: { query: { type: "string" } } },
              },
            ],
          },
        ],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] } },
      })
    }),
  )

  it.effect("continues image tool results as inline vision input without base64 text", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Gemini.GeminiBody>(
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

      expect(prepared.body.contents).toEqual([
        { role: "model", parts: [{ functionCall: { name: "read", args: { path: "pixel.png" } } }] },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "read",
                response: { name: "read", content: "Image read successfully" },
              },
            },
            { inlineData: { mimeType: "image/png", data: "AAECAw==" } },
          ],
        },
      ])
      expect(JSON.stringify(prepared.body.contents)).not.toContain('"content":"AAECAw=="')
    }),
  )

  it.effect("strips matching data URLs to raw base64 inlineData", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Gemini.GeminiBody>(
        LLM.request({
          model,
          messages: [
            Message.user({ type: "media", mediaType: "image/png", data: "data:image/png;base64,AAEC" }),
            Message.tool({
              id: "call_image",
              name: "read",
              result: {
                type: "content",
                value: [{ type: "file", uri: "data:image/jpeg;base64,/9j/", mime: "image/jpeg" }],
              },
            }),
          ],
        }),
      )
      expect(prepared.body.contents).toEqual([
        { role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "AAEC" } }] },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "read", response: { name: "read", content: "" } } },
            { inlineData: { mimeType: "image/jpeg", data: "/9j/" } },
          ],
        },
      ])
    }),
  )

  for (const [name, media] of [
    ["mismatched data URL MIME", { mediaType: "image/png", data: "data:image/jpeg;base64,/9j/" }],
    ["malformed base64", { mediaType: "image/png", data: "%%%=" }],
    ["unsupported SVG", { mediaType: "image/svg+xml", data: "PHN2Zz4=" }],
  ] as const)
    it.effect(`rejects ${name}`, () =>
      Effect.gen(function* () {
        const error = yield* LLMClient.prepare(
          LLM.request({ model, messages: [Message.user({ type: "media", ...media })] }),
        ).pipe(Effect.flip)
        expect(error.message).toMatch(/does not support|does not match|valid base64/)
      }),
    )

  it.effect("rejects oversized image input", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.prepare(
        LLM.request({
          model,
          messages: [
            Message.user({
              type: "media",
              mediaType: "image/png",
              data: "A".repeat(ProviderShared.MAX_MEDIA_ENCODED_BYTES + 4),
            }),
          ],
        }),
      ).pipe(Effect.flip)
      expect(error.message).toContain("encoded limit")
    }),
  )

  it.effect("omits tools when tool choice is none", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_no_tools",
          model,
          prompt: "Say hello.",
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
          toolChoice: { type: "none" },
        }),
      )

      expect(prepared.body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
      })
    }),
  )

  it.effect("sanitizes integer enums, dangling required, untyped arrays, and scalar object keys", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_schema_patch",
          model,
          prompt: "Use the tool.",
          tools: [
            {
              name: "lookup",
              description: "Lookup data",
              inputSchema: {
                type: "object",
                required: ["status", "missing"],
                properties: {
                  status: { type: "integer", enum: [1, 2] },
                  tags: { type: "array" },
                  name: { type: "string", properties: { ignored: { type: "string" } }, required: ["ignored"] },
                },
              },
            },
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [
          {
            functionDeclarations: [
              {
                parameters: {
                  type: "object",
                  required: ["status"],
                  properties: {
                    status: { type: "string", enum: ["1", "2"] },
                    tags: { type: "array", items: { type: "string" } },
                    name: { type: "string" },
                  },
                },
              },
            ],
          },
        ],
      })
    }),
  )

  it.effect("parses text, reasoning, and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "thinking", thought: true }] },
            },
          ],
        },
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Hello" }] },
            },
          ],
        },
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "!" }] },
              finishReason: "STOP",
            },
          ],
        },
        {
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            totalTokenCount: 7,
            thoughtsTokenCount: 1,
            cachedContentTokenCount: 1,
          },
        },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      expect(response.text).toBe("Hello!")
      expect(response.reasoning).toBe("thinking")
      expect(response.usage).toMatchObject({
        inputTokens: 5,
        outputTokens: 3,
        nonCachedInputTokens: 4,
        cacheReadInputTokens: 1,
        reasoningTokens: 1,
        totalTokens: 7,
      })
      const usage = new Usage({
        inputTokens: 5,
        outputTokens: 3,
        nonCachedInputTokens: 4,
        cacheReadInputTokens: 1,
        reasoningTokens: 1,
        totalTokens: 7,
        providerMetadata: {
          google: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            totalTokenCount: 7,
            thoughtsTokenCount: 1,
            cachedContentTokenCount: 1,
          },
        },
      })
      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        { type: "reasoning-start", id: "reasoning-0" },
        { type: "reasoning-delta", id: "reasoning-0", text: "thinking" },
        { type: "reasoning-end", id: "reasoning-0" },
        { type: "text-start", id: "text-0" },
        { type: "text-delta", id: "text-0", text: "Hello" },
        { type: "text-delta", id: "text-0", text: "!" },
        { type: "text-end", id: "text-0" },
        { type: "step-finish", index: 0, reason: "stop", usage, providerMetadata: undefined },
        {
          type: "finish",
          reason: "stop",
          usage,
        },
      ])
    }),
  )

  it.effect("preserves thoughtSignature for reasoning and tool-call continuation", () =>
    Effect.gen(function* () {
      const body = sseEvents({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { text: "thinking", thought: true },
                { text: "", thought: true, thoughtSignature: "thought_sig" },
                { functionCall: { name: "lookup", args: { query: "weather" } }, thoughtSignature: "tool_sig" },
              ],
            },
            finishReason: "STOP",
          },
        ],
      })
      const response = yield* LLMClient.generate(
        LLM.updateRequest(request, {
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))
      const reasoning = response.events.find((event) => event.type === "reasoning-start")
      const reasoningEnd = response.events.find((event) => event.type === "reasoning-end")
      const toolCall = response.events.find((event) => event.type === "tool-call")

      expect(reasoning).toEqual({
        type: "reasoning-start",
        id: "reasoning-0",
        providerMetadata: undefined,
      })
      expect(reasoningEnd).toEqual({
        type: "reasoning-end",
        id: "reasoning-0",
        providerMetadata: { google: { thoughtSignature: "thought_sig" } },
      })
      expect(toolCall).toMatchObject({ providerMetadata: { google: { thoughtSignature: "tool_sig" } } })
      expect(response.events.findIndex((event) => event.type === "reasoning-end")).toBeLessThan(
        response.events.findIndex((event) => event.type === "tool-call"),
      )

      const prepared = yield* LLMClient.prepare<Gemini.GeminiBody>(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              { type: "reasoning", text: "thinking", providerMetadata: reasoningEnd?.providerMetadata },
              ToolCallPart.make({
                id: "tool_0",
                name: "lookup",
                input: { query: "weather" },
                providerMetadata: toolCall?.providerMetadata,
              }),
            ]),
          ],
        }),
      )
      expect(prepared.body.contents).toEqual([
        {
          role: "model",
          parts: [
            { text: "thinking", thought: true, thoughtSignature: "thought_sig" },
            { functionCall: { name: "lookup", args: { query: "weather" } }, thoughtSignature: "tool_sig" },
          ],
        },
      ])
    }),
  )

  it.effect("emits streamed tool calls and maps finish reason", () =>
    Effect.gen(function* () {
      const body = sseEvents({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "lookup", args: { query: "weather" } } }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      })
      const response = yield* LLMClient.generate(
        LLM.updateRequest(request, {
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))
      const usage = new Usage({
        inputTokens: 5,
        outputTokens: 1,
        nonCachedInputTokens: 5,
        cacheReadInputTokens: undefined,
        reasoningTokens: undefined,
        totalTokens: 6,
        providerMetadata: { google: { promptTokenCount: 5, candidatesTokenCount: 1 } },
      })

      expect(response.toolCalls).toEqual([
        {
          type: "tool-call",
          id: "tool_0",
          name: "lookup",
          input: { query: "weather" },
          providerExecuted: undefined,
          providerMetadata: undefined,
        },
      ])
      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        {
          type: "tool-call",
          id: "tool_0",
          name: "lookup",
          input: { query: "weather" },
          providerExecuted: undefined,
          providerMetadata: undefined,
        },
        { type: "step-finish", index: 0, reason: "tool-calls", usage, providerMetadata: undefined },
        {
          type: "finish",
          reason: "tool-calls",
          usage,
        },
      ])
    }),
  )

  it.effect("assigns unique ids to multiple streamed tool calls", () =>
    Effect.gen(function* () {
      const body = sseEvents({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { functionCall: { name: "lookup", args: { query: "weather" } } },
                { functionCall: { name: "lookup", args: { query: "news" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
      })
      const response = yield* LLMClient.generate(
        LLM.updateRequest(request, {
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      expect(response.toolCalls).toEqual([
        { type: "tool-call", id: "tool_0", name: "lookup", input: { query: "weather" } },
        { type: "tool-call", id: "tool_1", name: "lookup", input: { query: "news" } },
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
    }),
  )

  it.effect("maps length and content-filter finish reasons", () =>
    Effect.gen(function* () {
      const length = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "MAX_TOKENS" }] }),
          ),
        ),
      )
      const filtered = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(sseEvents({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "SAFETY" }] })),
        ),
      )

      expect(length.events.map((event) => event.type)).toEqual(["step-start", "step-finish", "finish"])
      expect(length.events.at(-1)).toMatchObject({ type: "finish", reason: "length" })
      expect(filtered.events.map((event) => event.type)).toEqual(["step-start", "step-finish", "finish"])
      expect(filtered.events.at(-1)).toMatchObject({ type: "finish", reason: "content-filter" })
    }),
  )

  it.effect("leaves total usage undefined when component counts are missing", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseEvents({ usageMetadata: { thoughtsTokenCount: 1 } }))),
      )

      expect(response.usage).toMatchObject({ reasoningTokens: 1 })
      expect(response.usage?.totalTokens).toBeUndefined()
    }),
  )

  it.effect("fails invalid stream events", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(fixedResponse(sseRaw("data: {not json}"))),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(LLMError)
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput" })
      expect(error.message).toContain("Invalid google/gemini stream event")
    }),
  )

  it.effect("rejects unsupported assistant media content", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.prepare(
        LLM.request({
          id: "req_media",
          model,
          messages: [Message.assistant({ type: "media", mediaType: "image/png", data: "AAECAw==" })],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain(
        "Gemini assistant messages only support text, reasoning, and tool-call content for now",
      )
    }),
  )
})
