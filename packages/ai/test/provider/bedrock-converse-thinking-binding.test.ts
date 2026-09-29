import { EventStreamCodec } from "@smithy/eventstream-codec"
import { fromUtf8, toUtf8 } from "@smithy/util-utf8"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { GenerationOptions, LanguageModel, LLM, LLMRequest } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { AmazonBedrock } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"

const BETA = "thinking-binding-controls-2026-08-01"
const binding = { prefix_mismatch_behavior: "drop_block" }

const messageStop = new EventStreamCodec(toUtf8, fromUtf8).encode({
  headers: {
    ":message-type": { type: "string", value: "event" },
    ":event-type": { type: "string", value: "messageStop" },
    ":content-type": { type: "string", value: "application/json" },
  },
  body: new TextEncoder().encode(JSON.stringify({ stopReason: "end_turn" })),
})

const bedrock = (id: string, settings: Parameters<typeof AmazonBedrock.model>[1] = {}) =>
  AmazonBedrock.model(id, { baseURL: "https://bedrock-runtime.test", apiKey: "test-bearer", ...settings })

const request = (model: LanguageModel, generation?: GenerationOptions) =>
  LLM.request({ id: "req_1", model, system: "You are concise.", prompt: "Say hello.", cache: "none", generation })

// The protocol body only carries the default. The beta and the `http.body` overlay are applied when the transport
// prepares the request, so also capture the JSON Bedrock actually receives.
const wire = (input: LLMRequest) =>
  Effect.gen(function* () {
    const protocol = (yield* compileRequest(input)).body.additionalModelRequestFields
    const seen: Array<{ additionalModelRequestFields?: Record<string, unknown> }> = []
    yield* LLMClient.generate(input).pipe(
      Effect.provide(
        dynamicResponse((http) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(http.request)
            seen.push(yield* Effect.promise(() => web.json()))
            return http.respond(messageStop, { headers: { "content-type": "application/vnd.amazon.eventstream" } })
          }),
        ),
      ),
    )
    return { protocol, sent: seen[0]?.additionalModelRequestFields }
  })

describe("Bedrock Converse thinking block binding", () => {
  for (const id of [
    "global.anthropic.claude-fable-5-1",
    "us.anthropic.claude-fable-5-1-v1:0",
    "anthropic.claude-fable-5.1",
    "anthropic.claude-mythos-5-1",
    "us.anthropic.claude-opus-5-5",
    "global.anthropic.claude-sonnet-5-5",
    "anthropic.claude-opus-6",
  ]) {
    it.effect(`defaults adaptive thinking to drop_block with the beta for ${id}`, () =>
      Effect.gen(function* () {
        const result = yield* wire(request(bedrock(id)))
        expect(result.protocol).toEqual({ thinking: { type: "adaptive", block_binding: binding } })
        expect(result.sent).toEqual({ thinking: { type: "adaptive", block_binding: binding }, anthropic_beta: [BETA] })
      }),
    )
  }

  for (const id of [
    "global.anthropic.claude-opus-5",
    "us.anthropic.claude-sonnet-5",
    "global.anthropic.claude-fable-5",
    "anthropic.claude-fable-5-v1:0",
    "global.anthropic.claude-opus-4-8",
    "us.anthropic.claude-opus-4-5-20251101-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "us.amazon.nova-2-lite-v1:0",
  ]) {
    it.effect(`leaves ${id} untouched`, () =>
      Effect.gen(function* () {
        const result = yield* wire(request(bedrock(id)))
        expect(result.protocol).toBeUndefined()
        expect(result.sent).toBeUndefined()
      }),
    )
  }

  it.effect("binds a manual thinking budget and keeps top_k", () =>
    Effect.gen(function* () {
      const result = yield* wire(
        request(
          bedrock("global.anthropic.claude-fable-5-1", { thinking: { type: "enabled", budgetTokens: 4_000 } }),
          GenerationOptions.make({ maxTokens: 64_000, topK: 40 }),
        ),
      )
      const thinking = { type: "enabled", budget_tokens: 4_000, block_binding: binding }
      expect(result.protocol).toEqual({ top_k: 40, thinking })
      expect(result.sent).toEqual({ top_k: 40, thinking, anthropic_beta: [BETA] })
    }),
  )

  it.effect("keeps the caller's adaptive display and effort and binds beside them", () =>
    Effect.gen(function* () {
      const result = yield* wire(
        request(
          bedrock("global.anthropic.claude-fable-5-1", {
            body: {
              additionalModelRequestFields: {
                thinking: { type: "adaptive", display: "summarized" },
                output_config: { effort: "high" },
              },
            },
          }),
        ),
      )
      expect(result.sent).toEqual({
        thinking: { type: "adaptive", display: "summarized", block_binding: binding },
        output_config: { effort: "high" },
        anthropic_beta: [BETA],
      })
    }),
  )

  it.effect("lets the caller override the mismatch behavior", () =>
    Effect.gen(function* () {
      const result = yield* wire(
        request(
          bedrock("global.anthropic.claude-fable-5-1", {
            body: {
              additionalModelRequestFields: {
                thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "error" } },
              },
            },
          }),
        ),
      )
      expect(result.sent).toEqual({
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "error" } },
        anthropic_beta: [BETA],
      })
    }),
  )

  it.effect("does not bind disabled thinking", () =>
    Effect.gen(function* () {
      const result = yield* wire(
        request(
          bedrock("global.anthropic.claude-fable-5-1", {
            body: { additionalModelRequestFields: { thinking: { type: "disabled" } } },
          }),
        ),
      )
      expect(result.sent).toEqual({ thinking: { type: "disabled" } })
    }),
  )

  it.effect("adds the beta beside betas the caller already set", () =>
    Effect.gen(function* () {
      const result = yield* wire(
        request(
          bedrock("global.anthropic.claude-fable-5-1", {
            body: { additionalModelRequestFields: { anthropic_beta: ["context-1m-2025-08-07"] } },
          }),
        ),
      )
      expect(result.protocol).toEqual({ thinking: { type: "adaptive", block_binding: binding } })
      expect(result.sent).toEqual({
        thinking: { type: "adaptive", block_binding: binding },
        anthropic_beta: ["context-1m-2025-08-07", BETA],
      })
    }),
  )

  it.effect("does not repeat a beta the caller already set", () =>
    Effect.gen(function* () {
      const result = yield* wire(
        request(
          bedrock("global.anthropic.claude-fable-5-1", {
            body: { additionalModelRequestFields: { anthropic_beta: [BETA, "context-1m-2025-08-07"] } },
          }),
        ),
      )
      expect(result.sent?.anthropic_beta).toEqual([BETA, "context-1m-2025-08-07"])
    }),
  )

  it.effect("adds the beta for a binding the caller sends on any model", () =>
    Effect.gen(function* () {
      const result = yield* wire(
        request(
          bedrock("global.anthropic.claude-opus-5", {
            body: {
              additionalModelRequestFields: {
                thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
              },
            },
          }),
        ),
      )
      expect(result.protocol).toBeUndefined()
      expect(result.sent).toEqual({
        thinking: { type: "adaptive", block_binding: binding },
        anthropic_beta: [BETA],
      })
    }),
  )

  it.effect("honors the compatibility override in both directions", () =>
    Effect.gen(function* () {
      const arn = "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123"
      const opaque = yield* wire(
        request(LanguageModel.update(bedrock(arn), { compatibility: { supportsThinkingBlockBinding: true } })),
      )
      expect(opaque.sent).toEqual({ thinking: { type: "adaptive", block_binding: binding }, anthropic_beta: [BETA] })

      const noBinding = yield* wire(
        request(
          LanguageModel.update(bedrock("global.anthropic.claude-fable-5-1"), {
            compatibility: { supportsThinkingBlockBinding: false },
          }),
        ),
      )
      expect(noBinding.sent).toBeUndefined()

      const unknown = yield* wire(request(bedrock(arn)))
      expect(unknown.sent).toBeUndefined()
    }),
  )
})
