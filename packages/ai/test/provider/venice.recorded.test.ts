import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, LLMEvent, LLMRequest, Message, ToolChoice, ToolDefinition } from "../../src/index.js"
import { Venice } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.VENICE_API_KEY ?? "fixture"
const recorded = recordedTests({
  prefix: "venice-chat",
  provider: "venice",
  protocol: "venice-chat",
  requires: ["VENICE_API_KEY"],
})
const lookup = ToolDefinition.make({
  name: "lookup_rate",
  description: "Retrieve the private conversion rate for a code. Only this tool knows the rate.",
  inputSchema: {
    type: "object",
    properties: { code: { type: "string", enum: ["ZEBRA", "MOOSE"] } },
    required: ["code"],
    additionalProperties: false,
  },
})

for (const item of [
  { model: "deepseek-v4-flash", reasoning: "scalar" },
  { model: "z-ai-glm-5-3-flash", reasoning: "scalar" },
  { model: "qwen3-6-27b", reasoning: "scalar" },
  { model: "kimi-k2-6", reasoning: "scalar" },
  { model: "kimi-k3", reasoning: "scalar" },
  { model: "minimax-m27", reasoning: "scalar" },
  { model: "openai-gpt-oss-120b", reasoning: "scalar" },
  { model: "claude-sonnet-4-6", reasoning: "signed", effort: "high" },
  { model: "claude-opus-4-8", reasoning: "signed", effort: "high" },
  { model: "gemini-3-flash-preview", reasoning: "details" },
  { model: "gemini-3-1-pro-preview", reasoning: "details", effort: "high" },
  { model: "gemini-3-8-flash", reasoning: "signature" },
  { model: "openai-gpt-54-mini", reasoning: "encrypted" },
  { model: "openai-gpt-6-luna", reasoning: "encrypted" },
  { model: "grok-4-3", reasoning: "encrypted" },
] as const) {
  recorded.effect.with(
    `${item.model} preserves reasoning through a tool loop and follow-up`,
    {
      tags: ["reasoning", "tool", "tool-loop", "continuation", "usage", item.reasoning],
      metadata: { model: item.model },
    },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: Venice.configure({ apiKey }).chat(item.model),
          system:
            "Use the provided tool for private data. After receiving the result, give only the requested number; do not call the tool again.",
          prompt:
            "Look up conversion rate for code ZEBRA. Then multiply that rate by 17 and add 9. You must use lookup_rate before answering.",
          tools: [lookup],
          generation: { maxTokens: 4096 },
          providerOptions: "effort" in item ? { reasoningEffort: item.effort } : undefined,
        })
        const first = yield* LLMClient.generate(request)
        expect(first.toolCalls).toMatchObject([{ name: "lookup_rate", input: { code: "ZEBRA" } }])
        expect(first.finishReason.normalized).toBe("tool-calls")
        expect(first.events.filter(LLMEvent.is.finish)).toHaveLength(1)
        const continuation = LLMRequest.update(request, {
          toolChoice: ToolChoice.make("none"),
          messages: [
            ...request.messages,
            first.message,
            ...first.toolCalls.map((call) =>
              Message.tool({ id: call.id, name: call.name, result: { code: "ZEBRA", rate: 23 } }),
            ),
          ],
        })
        const compiled = yield* compileRequest(continuation)
        const assistant = compiled.body.messages.find((message) => message.role === "assistant")
        expect(assistant).toBeDefined()
        // Some models call a tool immediately and only reason after its result.
        if (item.reasoning === "scalar" && first.reasoning.length > 0) {
          expect(assistant).toMatchObject({ reasoning_content: first.reasoning })
        }
        if (item.reasoning === "signed") {
          const details = first.message.content
            .filter((part) => part.type === "reasoning")
            .flatMap((part) => part.providerMetadata?.venice?.reasoningDetails ?? [])
          expect(details).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: "reasoning.text", signature: expect.any(String) }),
            ]),
          )
          expect(assistant).toMatchObject({ reasoning_details: details })
        }
        if (item.reasoning === "details")
          expect(assistant).toMatchObject({
            reasoning_details: expect.arrayContaining([
              expect.objectContaining({ type: "reasoning.encrypted", data: expect.any(String) }),
            ]),
          })
        if (item.reasoning === "signature") {
          expect(first.toolCalls[0].providerMetadata?.venice?.thoughtSignature).toEqual(expect.any(String))
          expect(assistant).toMatchObject({
            tool_calls: [
              expect.objectContaining({
                thought_signature: first.toolCalls[0].providerMetadata?.venice?.thoughtSignature,
              }),
            ],
          })
        }
        if (item.reasoning === "encrypted") {
          expect(first.reasoning).not.toContain("__ENCRYPTED_REASONING__")
          const details = first.message.content
            .filter((part) => part.type === "reasoning")
            .flatMap((part) => part.providerMetadata?.venice?.reasoningDetails ?? [])
          if (details.length > 0) expect(assistant).toMatchObject({ reasoning_details: details })
        }
        const second = yield* LLMClient.generate(continuation)
        expect(second.text).toContain("400")
        expect(second.reasoning).not.toContain("__ENCRYPTED_REASONING__")
        expect(second.toolCalls).toHaveLength(0)
        expect(second.finishReason.normalized).toBe("stop")
        expect(second.usage?.inputTokens).toBeGreaterThan(0)
        expect(second.usage?.outputTokens).toBeGreaterThan(0)
        const followUp = LLMRequest.update(continuation, {
          messages: [
            ...continuation.messages,
            second.message,
            Message.user("Add 7 to your previous final answer. Reply with just the number."),
          ],
        })
        if (item.reasoning === "signature") {
          const signature = second.message.content
            .filter((part) => part.type === "text")
            .map((part) => part.providerMetadata?.venice?.messageThoughtSignature)
            .find((value) => value !== undefined)
          expect(signature).toEqual(expect.any(String))
          expect((yield* compileRequest(followUp)).body.messages).toEqual(
            expect.arrayContaining([expect.objectContaining({ role: "assistant", thought_signature: signature })]),
          )
        }
        const third = yield* LLMClient.generate(followUp)
        expect(third.text).toContain("407")
        expect(third.finishReason.normalized).toBe("stop")
        if (item.reasoning === "encrypted") {
          expect(
            [first, second, third].flatMap((response) =>
              response.message.content
                .filter((part) => part.type === "reasoning")
                .flatMap((part) => part.providerMetadata?.venice?.reasoningDetails ?? []),
            ),
          ).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: "reasoning.encrypted", data: expect.any(String) }),
            ]),
          )
        }
      }),
    180_000,
  )
}

recorded.effect.with(
  "Gemini preserves per-call signatures through parallel tools",
  { tags: ["tool", "parallel", "signature"] },
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: Venice.configure({ apiKey }).chat("gemini-3-8-flash"),
        prompt:
          "Look up private rates for both ZEBRA and MOOSE using two calls to lookup_rate. Then add the rates and multiply by 7. Use parallel calls if possible.",
        tools: [lookup],
        providerOptions: { reasoningEffort: "high", parallelToolCalls: true },
        generation: { maxTokens: 4096 },
      })
      const first = yield* LLMClient.generate(request)
      expect(first.toolCalls).toHaveLength(2)
      const continuation = LLMRequest.update(request, {
        toolChoice: ToolChoice.make("none"),
        messages: [
          ...request.messages,
          first.message,
          ...first.toolCalls.map((call) =>
            Message.tool({
              id: call.id,
              name: call.name,
              result: {
                rate:
                  Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(call.input).code === "ZEBRA"
                    ? 23
                    : 31,
              },
            }),
          ),
        ],
      })
      const compiled = yield* compileRequest(continuation)
      expect(compiled.body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tool_calls: first.toolCalls.map((call) =>
              expect.objectContaining({
                id: call.id,
                ...(call.providerMetadata?.venice?.thoughtSignature === undefined
                  ? {}
                  : { thought_signature: call.providerMetadata.venice.thoughtSignature }),
              }),
            ),
          }),
        ]),
      )
      expect((yield* LLMClient.generate(continuation)).text).toContain("378")
    }),
  180_000,
)

for (const enabled of [false, true]) {
  recorded.effect.with(
    `Qwen ${enabled ? "enables" : "disables"} reasoning`,
    { tags: ["text", "reasoning", "toggle"] },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            model: Venice.configure({ apiKey }).chat("qwen3-6-27b"),
            prompt: "What is 23 multiplied by 17 plus 9? Reply with just the number.",
            providerOptions: { reasoning: { enabled } },
            generation: { maxTokens: 4096 },
          }),
        )
        expect(response.text).toContain("400")
        expect(response.reasoning.length > 0).toBe(enabled)
      }),
    120_000,
  )
}

recorded.effect.with("surfaces Venice model errors", { tags: ["error"] }, () =>
  Effect.gen(function* () {
    const result = yield* LLMClient.generate(
      LLM.request({ model: Venice.configure({ apiKey }).chat("no-such-model-xyz"), prompt: "Hello" }),
    ).pipe(Effect.result)
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure.reason._tag).toBe("InvalidRequest")
      expect(result.failure.message).toContain("Specified model not found")
      expect(result.failure.reason.http?.status).toBe(404)
    }
  }),
)
