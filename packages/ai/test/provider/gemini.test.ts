import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, AIError, LLMRequest, Message, ToolCallPart, ToolDefinition, Usage } from "../../src/index.js"
import { Auth, LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import * as Gemini from "../../src/protocols/gemini.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents, sseRaw } from "../lib/sse.js"

const model = Gemini.route
  .with({
    endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
    auth: Auth.header("x-goog-api-key", "test"),
  })
  .model({ id: "gemini-2.5-flash" })

const gemini3 = Gemini.route
  .with({
    endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
    auth: Auth.header("x-goog-api-key", "test"),
  })
  .model({ id: "gemini-3-flash-preview" })

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
      const prepared = yield* compileRequest(request)

      expect(prepared.body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
        systemInstruction: { parts: [{ text: "You are concise." }] },
        generationConfig: { maxOutputTokens: 20, temperature: 0 },
      })
    }),
  )

  it.effect("normalizes Gemini thinking options", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: {
            gemini: {
              cachedContent: "cachedContents/example",
              safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" }],
              serviceTier: "priority",
              thinkingConfig: { thinkingBudget: 0, includeThoughts: false, thinkingLevel: "high" },
            },
          },
        }),
      )
      const filtered = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: { gemini: { thinkingConfig: { thinkingBudget: "invalid", includeThoughts: false } } },
        }),
      )
      const defaulted = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: { gemini: { thinkingConfig: { thinkingLevel: "high" } } },
        }),
      )
      const emptySafetySettings = yield* compileRequest(
        LLMRequest.update(request, {
          providerOptions: { gemini: { safetySettings: [] } },
        }),
      )

      expect(prepared.body.generationConfig?.thinkingConfig).toEqual({
        thinkingBudget: 0,
        includeThoughts: false,
        thinkingLevel: "high",
      })
      expect(prepared.body.cachedContent).toBe("cachedContents/example")
      expect(prepared.body.safetySettings).toEqual([
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      ])
      expect(prepared.body.serviceTier).toBe("priority")
      expect(filtered.body.generationConfig?.thinkingConfig).toEqual({ includeThoughts: false })
      expect(defaulted.body.generationConfig?.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingLevel: "high",
      })
      expect(emptySafetySettings.body.safetySettings).toEqual([])
    }),
  )

  it.effect("forwards standard Gemini generation options", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Say hello.",
          generation: {
            maxTokens: 40,
            temperature: 0.2,
            topP: 0.8,
            topK: 12,
            frequencyPenalty: 0.3,
            presencePenalty: 0.4,
            seed: 42,
            stop: ["done"],
          },
        }),
      )

      expect(prepared.body.generationConfig).toEqual({
        maxOutputTokens: 40,
        temperature: 0.2,
        topP: 0.8,
        topK: 12,
        frequencyPenalty: 0.3,
        presencePenalty: 0.4,
        seed: 42,
        stopSequences: ["done"],
        thinkingConfig: undefined,
      })
    }),
  )

  it.effect("lowers chronological system updates to wrapped user text in order", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
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
      const prepared = yield* compileRequest(
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
              { type: "media", mediaType: "application/pdf", data: "JVBERi0xLjQ=" },
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
            parts: [
              { text: "What is in this image?" },
              { inlineData: { mimeType: "image/png", data: "AAECAw==" } },
              { inlineData: { mimeType: "application/pdf", data: "JVBERi0xLjQ=" } },
            ],
          },
          {
            role: "model",
            parts: [{ functionCall: { name: "lookup", args: { query: "weather" } } }],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "lookup",
                  response: { name: "lookup", content: '{"forecast":"sunny"}' },
                },
              },
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

  it.effect("continues media tool results as inline model input without base64 text", () =>
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
                  { type: "file", uri: "data:application/pdf;base64,JVBERi0xLjQ=", mime: "application/pdf" },
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
                parts: [
                  { inlineData: { mimeType: "image/png", data: "AAECAw==" } },
                  { inlineData: { mimeType: "application/pdf", data: "JVBERi0xLjQ=" } },
                ],
              },
            },
          ],
        },
      ])
      expect(JSON.stringify(prepared.body.contents)).not.toContain('"content":"AAECAw=="')
    }),
  )

  it.effect("strips matching data URLs to raw base64 inlineData", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
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
            {
              functionResponse: {
                name: "read",
                response: { name: "read", content: "" },
                parts: [{ inlineData: { mimeType: "image/jpeg", data: "/9j/" } }],
              },
            },
          ],
        },
      ])
    }),
  )

  it.effect("passes encoded media through without local validation", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user([
              { type: "media", mediaType: "image/png", data: "%%%=" },
              { type: "media", mediaType: "image/png", data: "data:image/jpeg;base64,/9j/" },
              { type: "media", mediaType: "image/svg+xml", data: "PHN2Zz4=" },
            ]),
          ],
        }),
      )
      expect(prepared.body.contents).toEqual([
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: "%%%=" } },
            { inlineData: { mimeType: "image/png", data: "/9j/" } },
            { inlineData: { mimeType: "image/svg+xml", data: "PHN2Zz4=" } },
          ],
        },
      ])
    }),
  )

  it.effect("keeps tools and sends function calling mode NONE", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          id: "req_tool_choice_none",
          model,
          prompt: "Say hello.",
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
          toolChoice: { type: "none" },
        }),
      )

      expect(prepared.body).toMatchObject({
        contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
        tools: [{ functionDeclarations: [{ name: "lookup", description: "Lookup data" }] }],
        toolConfig: { functionCallingConfig: { mode: "NONE" } },
      })
    }),
  )

  it.effect("sanitizes integer enums, dangling required, untyped arrays, and scalar object keys", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
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

  it.effect("preserves nested empty object tool schemas", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Use the tool.",
          tools: [
            {
              name: "configure",
              description: "Configure the operation",
              inputSchema: {
                type: "object",
                required: ["options"],
                properties: {
                  options: { type: "object", description: "Optional provider settings", properties: {} },
                },
              },
            },
          ],
        }),
      )

      expect(prepared.body.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: "configure",
              description: "Configure the operation",
              parameters: {
                type: "object",
                required: ["options"],
                properties: {
                  options: { type: "object", description: "Optional provider settings", properties: {} },
                },
              },
            },
          ],
        },
      ])
    }),
  )

  it.effect("projects Gemini type arrays without narrowing their allowed values", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Use the tool.",
          tools: [
            {
              name: "filter",
              description: "Filter values",
              inputSchema: {
                type: "object",
                properties: {
                  status: { type: ["number", "string"], description: "Status filter" },
                  maybe: { type: ["string", "null"] },
                  nothing: { type: ["null"] },
                  explicit: { anyOf: [{ type: "string" }, { type: "null" }] },
                  choice: { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
                },
              },
            },
          ],
        }),
      )

      expect(prepared.body.tools?.[0]?.functionDeclarations[0]?.parameters).toEqual({
        type: "object",
        properties: {
          status: {
            description: "Status filter",
            anyOf: [{ type: "number" }, { type: "string" }],
          },
          maybe: {
            nullable: true,
            anyOf: [{ type: "string" }],
          },
          nothing: {
            type: "null",
          },
          explicit: {
            type: "string",
            nullable: true,
          },
          choice: {
            anyOf: [{ type: "string" }, { type: "number" }],
            nullable: true,
          },
        },
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
        {
          type: "step-finish",
          index: 0,
          reason: { normalized: "stop", raw: "STOP" },
          usage,
          providerMetadata: undefined,
        },
        {
          type: "finish",
          reason: { normalized: "stop", raw: "STOP" },
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
                {
                  functionCall: { id: "provider_call", name: "lookup", args: { query: "weather" } },
                  thoughtSignature: "tool_sig",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      })
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
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
      expect(toolCall).toMatchObject({
        id: "tool_0",
        providerMetadata: { google: { functionCallId: "provider_call", thoughtSignature: "tool_sig" } },
      })
      expect(response.events.findIndex((event) => event.type === "reasoning-end")).toBeLessThan(
        response.events.findIndex((event) => event.type === "tool-call"),
      )

      const prepared = yield* compileRequest(
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
            Message.tool({
              id: "tool_0",
              name: "lookup",
              result: "done",
              resultType: "text",
              providerMetadata: toolCall?.providerMetadata,
            }),
          ],
        }),
      )
      expect(prepared.body.contents).toEqual([
        {
          role: "model",
          parts: [
            { text: "thinking", thought: true, thoughtSignature: "thought_sig" },
            {
              functionCall: { id: "provider_call", name: "lookup", args: { query: "weather" } },
              thoughtSignature: "tool_sig",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "provider_call",
                name: "lookup",
                response: { name: "lookup", content: "done" },
              },
            },
          ],
        },
      ])
    }),
  )

  it.effect("replays unsigned Gemini 3 tool calls with the validator bypass sentinel", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: gemini3,
          messages: [
            Message.assistant([ToolCallPart.make({ id: "tool_0", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "tool_0", name: "lookup", result: "done", resultType: "text" }),
          ],
        }),
      )

      expect(prepared.body.contents).toEqual([
        {
          role: "model",
          parts: [
            {
              functionCall: { id: undefined, name: "lookup", args: { query: "weather" } },
              thoughtSignature: "skip_thought_signature_validator",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: undefined,
                name: "lookup",
                response: { name: "lookup", content: "done" },
              },
            },
          ],
        },
      ])
    }),
  )

  it.effect("leaves unsigned parallel calls unchanged after a signed Gemini 3 call", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: gemini3,
          messages: [
            Message.assistant([
              ToolCallPart.make({
                id: "tool_0",
                name: "lookup",
                input: { query: "weather" },
                providerMetadata: { google: { thoughtSignature: "parallel_signature" } },
              }),
              ToolCallPart.make({ id: "tool_1", name: "lookup", input: { query: "news" } }),
              ToolCallPart.make({ id: "tool_2", name: "lookup", input: { query: "sports" } }),
            ]),
          ],
        }),
      )

      expect(prepared.body.contents).toEqual([
        {
          role: "model",
          parts: [
            {
              functionCall: { id: undefined, name: "lookup", args: { query: "weather" } },
              thoughtSignature: "parallel_signature",
            },
            {
              functionCall: { id: undefined, name: "lookup", args: { query: "news" } },
              thoughtSignature: undefined,
            },
            {
              functionCall: { id: undefined, name: "lookup", args: { query: "sports" } },
              thoughtSignature: undefined,
            },
          ],
        },
      ])
    }),
  )

  it.effect("adds the validator bypass sentinel to every call in an unsigned Gemini 3 batch", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: gemini3,
          messages: [
            Message.assistant([
              ToolCallPart.make({ id: "tool_0", name: "lookup", input: { query: "weather" } }),
              ToolCallPart.make({ id: "tool_1", name: "lookup", input: { query: "news" } }),
            ]),
          ],
        }),
      )

      expect(prepared.body.contents).toEqual([
        {
          role: "model",
          parts: [
            {
              functionCall: { id: undefined, name: "lookup", args: { query: "weather" } },
              thoughtSignature: "skip_thought_signature_validator",
            },
            {
              functionCall: { id: undefined, name: "lookup", args: { query: "news" } },
              thoughtSignature: "skip_thought_signature_validator",
            },
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
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
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
        {
          type: "step-finish",
          index: 0,
          reason: { normalized: "tool-calls", raw: "STOP" },
          usage,
          providerMetadata: undefined,
        },
        {
          type: "finish",
          reason: { normalized: "tool-calls", raw: "STOP" },
          usage,
        },
      ])
    }),
  )

  it.effect("defaults omitted function call args to an empty object", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "ping", description: "Ping", inputSchema: { type: "object" } })],
        }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              candidates: [
                {
                  content: { role: "model", parts: [{ functionCall: { name: "ping" } }] },
                  finishReason: "STOP",
                },
              ],
            }),
          ),
        ),
      )

      expect(response.toolCalls).toEqual([{ type: "tool-call", id: "tool_0", name: "ping", input: {} }])
    }),
  )

  it.effect("maps tool calls without a finish reason", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ functionCall: { name: "lookup", args: { query: "weather" } } }],
                  },
                },
              ],
              usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
            }),
          ),
        ),
      )

      expect(response.finishReason).toEqual({ normalized: "tool-calls", raw: undefined })
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
                { functionCall: { id: "tool_0", name: "lookup", args: { query: "weather" } } },
                { functionCall: { name: "lookup", args: { query: "news" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
      })
      const response = yield* LLMClient.generate(
        LLMRequest.update(request, {
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      expect(response.toolCalls).toEqual([
        {
          type: "tool-call",
          id: "tool_0",
          name: "lookup",
          input: { query: "weather" },
          providerMetadata: { google: { functionCallId: "tool_0" } },
        },
        { type: "tool-call", id: "tool_1", name: "lookup", input: { query: "news" } },
      ])
      expect(response.events.at(-1)).toMatchObject({
        type: "finish",
        reason: { normalized: "tool-calls", raw: "STOP" },
      })
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
      expect(length.events.at(-1)).toMatchObject({
        type: "finish",
        reason: { normalized: "length", raw: "MAX_TOKENS" },
      })
      expect(filtered.events.map((event) => event.type)).toEqual(["step-start", "step-finish", "finish"])
      expect(filtered.events.at(-1)).toMatchObject({
        type: "finish",
        reason: { normalized: "content-filter", raw: "SAFETY" },
      })
    }),
  )

  it.effect("preserves candidate-less prompt safety blocks as content-filter outcomes", () =>
    Effect.gen(function* () {
      const blocked = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              promptFeedback: {
                blockReason: "FUTURE_SAFETY_REASON",
                blockReasonMessage: "Prompt blocked",
                safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", blocked: true }],
              },
            }),
          ),
        ),
      )
      const blockedWithUsage = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { promptFeedback: { blockReason: "SAFETY" } },
              { usageMetadata: { promptTokenCount: 7, totalTokenCount: 7 } },
            ),
          ),
        ),
      )

      expect(blocked.events.map((event) => event.type)).toEqual(["step-start", "step-finish", "finish"])
      expect(blocked.events.at(-1)).toMatchObject({
        type: "finish",
        reason: { normalized: "content-filter", raw: "FUTURE_SAFETY_REASON" },
        providerMetadata: {
          google: {
            promptFeedback: {
              blockReason: "FUTURE_SAFETY_REASON",
              blockReasonMessage: "Prompt blocked",
              safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", blocked: true }],
            },
          },
        },
      })
      expect(blockedWithUsage.finishReason).toEqual({ normalized: "content-filter", raw: "SAFETY" })
      expect(blockedWithUsage.usage).toMatchObject({ inputTokens: 7, totalTokens: 7 })
    }),
  )

  it.effect("maps current blocking and invalid-output finish reasons", () =>
    Effect.gen(function* () {
      const reasons = [
        ["MODEL_ARMOR", "content-filter"],
        ["IMAGE_PROHIBITED_CONTENT", "content-filter"],
        ["IMAGE_RECITATION", "content-filter"],
        ["LANGUAGE", "content-filter"],
        ["UNEXPECTED_TOOL_CALL", "error"],
        ["NO_IMAGE", "error"],
        ["IMAGE_OTHER", "unknown"],
        ["TOO_MANY_TOOL_CALLS", "error"],
        ["MISSING_THOUGHT_SIGNATURE", "error"],
        ["MALFORMED_RESPONSE", "error"],
      ] as const

      for (const [raw, normalized] of reasons) {
        const response = yield* LLMClient.generate(request).pipe(
          Effect.provide(
            fixedResponse(sseEvents({ candidates: [{ content: { role: "model", parts: [] }, finishReason: raw }] })),
          ),
        )
        expect(response.finishReason).toEqual({ normalized, raw })
      }
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

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput" })
      expect(error.message).toContain("Invalid google/gemini stream event")
    }),
  )

  it.effect("rejects unsupported assistant media content", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
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
