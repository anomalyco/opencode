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
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { LLMNative } from "../../src/session/llm-native"
import { LLMNativeEvents } from "../../src/session/llm-native-events"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider"
import type { Tool } from "../../src/tool"

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
