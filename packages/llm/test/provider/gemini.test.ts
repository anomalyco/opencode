import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
import { Gemini } from "../../src/provider/gemini"
import { testEffect } from "../lib/effect"
import { fixedResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

const model = Gemini.model({
  id: "gemini-2.5-flash",
  baseURL: "https://generativelanguage.test/v1beta/",
  headers: { "x-goog-api-key": "test" },
})

const request = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

const it = testEffect(Layer.empty)

describe("Gemini adapter", () => {
  it.effect("prepares Gemini target", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [Gemini.adapter] }).prepare(request)

      expect(prepared.target).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
        systemInstruction: { parts: [{ text: "You are concise." }] },
        generationConfig: { maxOutputTokens: 20, temperature: 0 },
      })
    }),
  )

  it.effect("prepares multimodal user input and tool history", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [Gemini.adapter] }).prepare(
        LLM.request({
          id: "req_tool_result",
          model,
          tools: [{
            name: "lookup",
            description: "Lookup data",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
          }],
          toolChoice: { type: "tool", name: "lookup" },
          messages: [
            LLM.user([
              { type: "text", text: "What is in this image?" },
              { type: "media", mediaType: "image/png", data: "AAECAw==" },
            ]),
            LLM.assistant([LLM.toolCall({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            LLM.toolMessage({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.target).toEqual({
        contents: [
          {
            role: "user",
            parts: [
              { text: "What is in this image?" },
              { inlineData: { mimeType: "image/png", data: "AAECAw==" } },
            ],
          },
          {
            role: "model",
            parts: [{ functionCall: { name: "lookup", args: { query: "weather" } } }],
          },
          {
            role: "user",
            parts: [{ functionResponse: { name: "lookup", response: { name: "lookup", content: '{"forecast":"sunny"}' } } }],
          },
        ],
        tools: [{
          functionDeclarations: [{
            name: "lookup",
            description: "Lookup data",
            parameters: { type: "object", properties: { query: { type: "string" } } },
          }],
        }],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] } },
      })
    }),
  )

  it.effect("parses text, reasoning, and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        {
          candidates: [{
            content: { role: "model", parts: [{ text: "thinking", thought: true }] },
          }],
        },
        {
          candidates: [{
            content: { role: "model", parts: [{ text: "Hello" }] },
          }],
        },
        {
          candidates: [{
            content: { role: "model", parts: [{ text: "!" }] },
            finishReason: "STOP",
          }],
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
      const response = yield* client({ adapters: [Gemini.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(body)))

      expect(LLM.outputText(response)).toBe("Hello!")
      expect(LLM.outputReasoning(response)).toBe("thinking")
      expect(LLM.outputUsage(response)).toMatchObject({
        inputTokens: 5,
        outputTokens: 2,
        reasoningTokens: 1,
        cacheReadInputTokens: 1,
        totalTokens: 7,
      })
      expect(response.events).toEqual([
        { type: "reasoning-delta", text: "thinking" },
        { type: "text-delta", text: "Hello" },
        { type: "text-delta", text: "!" },
        {
          type: "request-finish",
          reason: "stop",
          usage: {
            inputTokens: 5,
            outputTokens: 2,
            reasoningTokens: 1,
            cacheReadInputTokens: 1,
            totalTokens: 7,
            native: {
              promptTokenCount: 5,
              candidatesTokenCount: 2,
              totalTokenCount: 7,
              thoughtsTokenCount: 1,
              cachedContentTokenCount: 1,
            },
          },
        },
      ])
    }),
  )

  it.effect("emits streamed tool calls and maps finish reason", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        {
          candidates: [{
            content: {
              role: "model",
              parts: [{ functionCall: { name: "lookup", args: { query: "weather" } } }],
            },
            finishReason: "STOP",
          }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
        },
      )
      const response = yield* client({ adapters: [Gemini.adapter] })
        .generate(
          LLM.request({
            ...request,
            tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
          }),
        )
        .pipe(Effect.provide(fixedResponse(body)))

      expect(LLM.outputToolCalls(response)).toEqual([{ type: "tool-call", id: "tool_0", name: "lookup", input: { query: "weather" } }])
      expect(response.events).toEqual([
        { type: "tool-input-delta", id: "tool_0", name: "lookup", text: '{"query":"weather"}' },
        { type: "tool-call", id: "tool_0", name: "lookup", input: { query: "weather" } },
        {
          type: "request-finish",
          reason: "tool-calls",
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6, native: { promptTokenCount: 5, candidatesTokenCount: 1 } },
        },
      ])
    }),
  )

  it.effect("rejects unsupported assistant media content", () =>
    Effect.gen(function* () {
      const error = yield* client({ adapters: [Gemini.adapter] })
        .prepare(
          LLM.request({
            id: "req_media",
            model,
            messages: [LLM.assistant({ type: "media", mediaType: "image/png", data: "AAECAw==" })],
          }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("Gemini assistant messages only support text, reasoning, and tool-call content for now")
    }),
  )
})
