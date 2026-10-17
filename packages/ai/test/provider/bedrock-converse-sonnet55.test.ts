import { EventStreamCodec } from "@smithy/eventstream-codec"
import { fromUtf8, toUtf8 } from "@smithy/util-utf8"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMRequest, ToolChoice, ToolDefinition } from "../../src/index.js"
import { AmazonBedrock } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"

const bedrock = (id: string, settings: Parameters<typeof AmazonBedrock.model>[1] = {}) =>
  AmazonBedrock.model(id, { baseURL: "https://bedrock-runtime.test", apiKey: "test-bearer", ...settings })

const request = LLM.request({
  model: bedrock("global.anthropic.claude-sonnet-5-5"),
  prompt: "What is the weather?",
  cache: "none",
  tools: [ToolDefinition.make({ name: "lookup", description: "Weather lookup", inputSchema: { type: "object" } })],
})

describe("Bedrock Converse Claude Sonnet 5.5", () => {
  it.effect("rejects required tool choice rather than silently allowing a different tool policy", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, { toolChoice: ToolChoice.make({ type: "required" }) }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("tool choice")
    }),
  )

  it.effect("rejects named tool choice supplied by a body overlay", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, { http: { body: { toolConfig: { toolChoice: { tool: { name: "lookup" } } } } } }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("tool choice")
    }),
  )

  it.effect("rejects manual thinking budgets instead of silently dropping the budget", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, {
          model: bedrock("global.anthropic.claude-sonnet-5-5", {
            thinking: { type: "enabled", budgetTokens: 4_000 },
          }),
        }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("manual thinking")
    }),
  )

  it.effect("rejects explicitly disabled thinking with an actionable alternative", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, {
          http: { body: { additionalModelRequestFields: { thinking: { type: "disabled" } } } },
        }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("between_tools")
    }),
  )

  it.effect("rejects non-default temperature without discarding the caller's sampling preference", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(LLMRequest.update(request, { generation: { temperature: 0 } })).pipe(
        Effect.flip,
      )

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("temperature")
    }),
  )

  it.effect("rejects non-default topP configured through the Bedrock provider", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, { model: bedrock("global.anthropic.claude-sonnet-5-5", { topP: 0.8 }) }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("topP")
    }),
  )

  it.effect("rejects non-default topK in additional model request fields", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(LLMRequest.update(request, { generation: { topK: 40 } })).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("top_k")
    }),
  )

  it.effect("does not add adaptive thinking binding to an explicit between_tools request", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          http: { body: { additionalModelRequestFields: { thinking: { type: "between_tools" } } } },
        }),
      )

      expect(prepared.body.additionalModelRequestFields).toBeUndefined()
    }),
  )

  it.effect("accepts between_tools as a typed Bedrock model setting", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          model: bedrock("global.anthropic.claude-sonnet-5-5", { thinking: { type: "between_tools" } }),
        }),
      )

      expect(prepared.body.additionalModelRequestFields).toEqual({ thinking: { type: "between_tools" } })
    }),
  )

  it.effect("rejects a between_tools overlay that retains a manual budget", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, {
          model: bedrock("global.anthropic.claude-sonnet-5-5", {
            thinking: { type: "enabled", budgetTokens: 4_000 },
          }),
          http: { body: { additionalModelRequestFields: { thinking: { type: "between_tools" } } } },
        }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("between_tools")
    }),
  )

  it.effect("rejects between_tools at unsupported max effort", () =>
    Effect.gen(function* () {
      const error = yield* compileRequest(
        LLMRequest.update(request, {
          model: bedrock("global.anthropic.claude-sonnet-5-5", { thinking: { type: "between_tools" } }),
          http: { body: { additionalModelRequestFields: { output_config: { effort: "max" } } } },
        }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("max")
    }),
  )

  it.effect("sends between_tools without block binding and preserves auto tool choice on the wire", () =>
    Effect.gen(function* () {
      const bodies: Array<Record<string, unknown>> = []
      const response = new EventStreamCodec(toUtf8, fromUtf8).encode({
        headers: {
          ":message-type": { type: "string", value: "event" },
          ":event-type": { type: "string", value: "messageStop" },
          ":content-type": { type: "string", value: "application/json" },
        },
        body: new TextEncoder().encode('{"stopReason":"end_turn"}'),
      })
      yield* LLMClient.generate(
        LLMRequest.update(request, {
          toolChoice: ToolChoice.make({ type: "auto" }),
          http: { body: { additionalModelRequestFields: { thinking: { type: "between_tools" } } } },
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const sent = yield* HttpClientRequest.toWeb(input.request)
              bodies.push(JSON.parse(yield* Effect.promise(() => sent.text())))
              return input.respond(response, { headers: { "content-type": "application/vnd.amazon.eventstream" } })
            }),
          ),
        ),
      )

      expect(bodies[0]?.additionalModelRequestFields).toEqual({ thinking: { type: "between_tools" } })
      expect(bodies[0]?.toolConfig).toMatchObject({ toolChoice: { auto: {} } })
    }),
  )

  it.effect("keeps Sonnet 5.5 defaults and supported sampling defaults", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLMRequest.update(request, {
          toolChoice: ToolChoice.make({ type: "none" }),
          generation: { temperature: 1, topP: 0.999, topK: 0 },
        }),
      )

      expect(prepared.body.toolConfig?.toolChoice).toBeUndefined()
      expect(prepared.body.inferenceConfig).toMatchObject({ temperature: 1, topP: 0.999 })
      expect(prepared.body.additionalModelRequestFields).toMatchObject({ top_k: 0, thinking: { type: "adaptive" } })
    }),
  )

  it.effect("keeps earlier Claude and other Bedrock models' request behavior", () =>
    Effect.gen(function* () {
      for (const id of ["us.anthropic.claude-sonnet-4-6", "us.amazon.nova-2-lite-v1:0"]) {
        const prepared = yield* compileRequest(
          LLMRequest.update(request, {
            model: bedrock(id),
            toolChoice: ToolChoice.make({ type: "required" }),
            generation: { temperature: 0 },
          }),
        )

        expect(prepared.body.toolConfig?.toolChoice).toEqual({ any: {} })
        expect(prepared.body.inferenceConfig).toEqual({ temperature: 0 })
      }
    }),
  )
})
