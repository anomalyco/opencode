import { describe, expect } from "bun:test"
import {
  AnthropicMessages,
  BedrockConverse,
  Gemini,
  LLMClient,
  OpenAIChat,
  OpenAICompatibleChat,
  OpenAIResponses,
  ProviderPatch,
  RequestExecutor,
} from "@opencode-ai/llm"
import { Effect, Layer, Ref, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { tool, jsonSchema } from "ai"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { LLMNative } from "../../src/session/llm-native"
import { LLMNativeEvents } from "../../src/session/llm-native-events"
import { LLMNativeTools } from "../../src/session/llm-native-tools"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"
import type { Tool } from "../../src/tool/tool"

// Inline HTTP layer that returns a single fixed body. Mirrors the
// `fixedResponse` helper in `packages/llm/test/lib/http.ts` — duplicated here
// rather than imported across packages so this test stays self-contained.
const fixedResponse = (body: BodyInit, init: ResponseInit = { headers: { "content-type": "text/event-stream" } }) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, init))),
        ),
      ),
    ),
  )

// Scripted multi-response HTTP layer. Each request consumes the next body in
// order; the final body repeats if more requests arrive. Mirrors the
// `scriptedResponses` helper in `packages/llm/test/lib/http.ts`.
const scriptedResponses = (bodies: ReadonlyArray<BodyInit>, init: ResponseInit = { headers: { "content-type": "text/event-stream" } }) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const cursor = yield* Ref.make(0)
          return Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.gen(function* () {
                const index = yield* Ref.getAndUpdate(cursor, (n) => n + 1)
                const body = bodies[index] ?? bodies[bodies.length - 1]
                return HttpClientResponse.fromWeb(request, new Response(body, init))
              }),
            ),
          )
        }),
      ),
    ),
  )

// Encode an Anthropic SSE body. Each event becomes a `data:` line; the codec
// also expects `event:` lines but the package's SSE framing only reads the
// data field.
const sseBody = (events: ReadonlyArray<unknown>) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n"

const sessionID = SessionID.descending()

const anthropicModel = (override: Partial<Provider.Model> = {}): Provider.Model =>
  ProviderTest.model({
    id: ModelID.make("claude-sonnet-4-5"),
    providerID: ProviderID.make("anthropic"),
    api: { id: "claude-sonnet-4-5", url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
    ...override,
  })

const userPart = (messageID: MessageID, text: string): MessageV2.TextPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "text",
  text,
})

const userMessage = (mdl: Provider.Model, id: MessageID, parts: MessageV2.Part[]): MessageV2.WithParts => ({
  info: {
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: mdl.providerID, modelID: mdl.id },
  },
  parts,
})

// What `runNative` builds. Kept in sync with `session/llm.ts`'s
// NATIVE_ADAPTERS list — if a protocol is added there, add it here.
const adapters = [
  AnthropicMessages.adapter,
  OpenAIChat.adapter,
  OpenAIResponses.adapter,
  Gemini.adapter,
  OpenAICompatibleChat.adapter,
  BedrockConverse.adapter,
]

const it = testEffect(Layer.empty)

describe("LLMNative stream wire-up (audit gap #4 phase 1)", () => {
  it.effect("converts an Anthropic SSE response into session events via the LLMNative path", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const provider = ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl)
      const userID = MessageID.ascending()

      const llmRequest = yield* LLMNative.request({
        id: "smoke-test",
        provider,
        model: mdl,
        system: ["You are concise."],
        messages: [userMessage(mdl, userID, [userPart(userID, "Say hello.")])],
      })

      const client = LLMClient.make({ adapters, patches: ProviderPatch.defaults })
      const map = LLMNativeEvents.mapper()

      const body = sseBody([
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "!" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ])

      const events = yield* client.stream(llmRequest).pipe(
        Stream.flatMap((event) => Stream.fromIterable(map.map(event))),
        Stream.concat(Stream.unwrap(Effect.sync(() => Stream.fromIterable(map.flush())))),
        Stream.runCollect,
        Effect.provide(fixedResponse(body)),
      )

      const collected = Array.from(events)

      // The mapper synthesizes text-start on first text-delta, then closes
      // open parts at finish. Assert key milestones rather than the full
      // shape (the AI SDK event vocabulary has a lot of boilerplate fields
      // populated by `LLMNativeEvents` that we don't want to over-constrain).
      const textDelta = collected.find((event) => event.type === "text-delta")
      expect(textDelta).toMatchObject({ type: "text-delta", text: "Hello" })

      const textStart = collected.findIndex((event) => event.type === "text-start")
      const firstDelta = collected.findIndex((event) => event.type === "text-delta")
      expect(textStart).toBeGreaterThanOrEqual(0)
      expect(textStart).toBeLessThan(firstDelta)

      const finishStep = collected.find((event) => event.type === "finish-step")
      expect(finishStep).toMatchObject({ finishReason: "stop" })

      const finish = collected.find((event) => event.type === "finish")
      expect(finish).toMatchObject({
        finishReason: "stop",
        totalUsage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      })

      // No tool events on a text-only happy path.
      expect(collected.some((event) => event.type === "tool-call")).toBe(false)
      expect(collected.some((event) => event.type === "error")).toBe(false)
    }),
  )

  // Phase 2 step 2b: drives the streaming-dispatch loop end-to-end. The
  // scripted Anthropic backend replies in two rounds — round 1 is a tool
  // call, round 2 is text after the tool result feeds back. Asserts that
  // `runWithTools` (a) forks the AI SDK execute when the `tool-call` event
  // arrives, (b) injects a synthetic `tool-result` event into the same
  // stream, (c) issues a continuation request with the tool result in
  // history, and (d) the stream concludes with the second-round text.
  it.effect("dispatches a tool call mid-stream and continues the conversation", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const lookupParameters = Schema.Struct({
        query: Schema.String.annotate({ description: "Search query" }),
      })
      const lookupTool: Tool.Def<typeof lookupParameters> = {
        id: "lookup",
        description: "Lookup project data",
        parameters: lookupParameters,
        execute: () => Effect.succeed({ title: "Weather lookup", metadata: {}, output: '{"forecast":"sunny"}' }),
      }

      // AI SDK side: the same tool wrapped so `tool.execute(args, opts)`
      // resolves with the same opencode `ExecuteResult` shape the live
      // `prompt.ts:resolveTools` would produce. The dispatcher inside
      // `runWithTools` calls this; the synthetic `tool-result` LLM event
      // carries the result back into the stream.
      const aiTool = tool({
        description: "Lookup project data",
        inputSchema: jsonSchema({
          type: "object",
          properties: { query: { type: "string", description: "Search query" } },
          required: ["query"],
        }),
        execute: async () => ({
          title: "Weather lookup",
          metadata: {},
          output: '{"forecast":"sunny"}',
        }),
      })

      const userID = MessageID.ascending()
      const llmRequest = yield* LLMNative.request({
        id: "smoke-tool-loop",
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        system: ["Be concise."],
        messages: [userMessage(mdl, userID, [userPart(userID, "What is the weather?")])],
        tools: [lookupTool],
      })

      // Round 1: model issues `lookup` tool call.
      const round1 = sseBody([
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "lookup" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query"' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"weather"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ])
      // Round 2: model replies with text after seeing the tool result.
      const round2 = sseBody([
        { type: "message_start", message: { usage: { input_tokens: 12 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "It is sunny." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
        { type: "message_stop" },
      ])

      const client = LLMClient.make({ adapters, patches: ProviderPatch.defaults })
      const map = LLMNativeEvents.mapper()

      const events = yield* LLMNativeTools.runWithTools({
        client,
        request: llmRequest,
        tools: { lookup: aiTool },
        abort: new AbortController().signal,
      }).pipe(
        Stream.flatMap((event) => Stream.fromIterable(map.map(event))),
        Stream.concat(Stream.unwrap(Effect.sync(() => Stream.fromIterable(map.flush())))),
        Stream.runCollect,
        Effect.provide(scriptedResponses([round1, round2])),
      )

      const collected = Array.from(events)

      // Round 1: tool call streams, dispatcher fires, synthetic tool-result lands.
      const toolCall = collected.find((event) => event.type === "tool-call")
      expect(toolCall).toMatchObject({
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "lookup",
        input: { query: "weather" },
      })

      const toolResult = collected.find((event) => event.type === "tool-result")
      expect(toolResult).toMatchObject({
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "lookup",
        output: { title: "Weather lookup", output: '{"forecast":"sunny"}' },
      })

      // Round 2: text-delta arrives after the tool result.
      const round2Text = collected.find((event) => event.type === "text-delta")
      expect(round2Text).toMatchObject({ type: "text-delta", text: "It is sunny." })

      // Final finish should be `stop`, not `tool-calls` (tool loop terminated).
      const finalFinish = [...collected].reverse().find((event) => event.type === "finish")
      expect(finalFinish).toMatchObject({ finishReason: "stop" })

      // No errors leaked through.
      expect(collected.some((event) => event.type === "error")).toBe(false)
    }),
  )

  // Phase 2 step 2a: verifies a tool-bearing `nativeTools` array reaches the
  // wire as Anthropic `tools[]` blocks. The model in this fixture answers with
  // plain text instead of issuing a tool call (we don't yet have dispatch).
  // This proves tool definitions plumb through `LLMNative.request` →
  // `LLMRequest` → adapter `prepare` → wire body.
  it.effect("forwards nativeTools to the wire as Anthropic tools when the gate is open", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const provider = ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl)
      const userID = MessageID.ascending()

      const lookupParameters = Schema.Struct({
        query: Schema.String.annotate({ description: "Search query" }),
      })
      const lookupTool: Tool.Def<typeof lookupParameters> = {
        id: "lookup",
        description: "Lookup project data",
        parameters: lookupParameters,
        execute: () => Effect.succeed({ title: "", metadata: {}, output: "" }),
      }

      const llmRequest = yield* LLMNative.request({
        id: "smoke-tools",
        provider,
        model: mdl,
        system: ["You are concise."],
        messages: [userMessage(mdl, userID, [userPart(userID, "Look something up.")])],
        tools: [lookupTool],
      })

      const prepared = yield* LLMClient.make({ adapters, patches: ProviderPatch.defaults }).prepare(llmRequest)
      expect(prepared.target).toMatchObject({
        tools: [
          {
            name: "lookup",
            description: "Lookup project data",
            input_schema: {
              type: "object",
              properties: { query: { type: "string", description: "Search query" } },
              required: ["query"],
            },
          },
        ],
      })
    }),
  )
})
