import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, Message, ToolChoice, ToolDefinition } from "../../src/index.js"
import { Meta } from "../../src/providers/meta.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const model = Meta.configure({ apiKey: process.env.META_API_KEY ?? "fixture" }).messages("muse-spark-1.3")
const recorded = recordedTests({
  prefix: "meta-messages",
  provider: "meta",
  protocol: "meta-messages",
  requires: ["META_API_KEY"],
  metadata: { model: model.id },
})

for (const mode of ["adaptive", "enabled"] as const) {
  recorded.effect.with(
    `streams text with ${mode} thinking`,
    { tags: ["text", "reasoning", mode] },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model,
          prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
          generation: { maxTokens: 2048 },
          providerOptions: {
            thinking:
              mode === "adaptive"
                ? { type: "adaptive", display: "omitted" }
                : { type: "enabled", budgetTokens: 1024, display: "omitted" },
            effort: "low",
          },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body).toMatchObject({
          stream: true,
          max_tokens: 2048,
          thinking: { type: mode, display: "omitted" },
          output_config: { effort: "low" },
        })
        if (mode === "enabled") expect(compiled.body.thinking.budget_tokens).toBe(1024)
        const response = yield* LLMClient.generate(request)
        expect(response.text.replaceAll(",", "").trim()).toBe("37887")
        expect(response.finishReason.normalized).toBe("stop")
        expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
        expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
        expect(
          response.message.content.find((part) => part.type === "reasoning")?.providerMetadata?.meta?.redactedData,
        ).toEqual(expect.stringMatching(/\S/))
        expect(response.usage?.reasoningTokens).toBeGreaterThan(0)
      }),
    90_000,
  )
}

recorded.effect.with(
  "replays encrypted thinking through a tool loop",
  { tags: ["tool", "tool-loop", "reasoning"] },
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model,
        prompt:
          "Look up the current weather in Paris using lookup_weather. After receiving the result, report Paris's weather in one short sentence.",
        tools: [
          ToolDefinition.make({
            name: "lookup_weather",
            description: "Look up current weather",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string", enum: ["Paris"] } },
              required: ["city"],
              additionalProperties: false,
            },
          }),
        ],
        toolChoice: "auto",
        generation: { maxTokens: 1024 },
        providerOptions: { effort: "low" },
      })
      const compiled = yield* compileRequest(request)
      expect(compiled.body.tool_choice).toEqual({ type: "auto" })
      const first = yield* LLMClient.generate(request)
      expect(first.finishReason.normalized).toBe("tool-calls")
      expect(first.toolCalls).toHaveLength(1)
      expect(first.toolCalls[0]).toMatchObject({ name: "lookup_weather", input: { city: "Paris" } })
      expect(first.events.some(LLMEvent.is.toolInputDelta)).toBe(true)
      const encrypted = first.message.content.find((part) => part.type === "reasoning")?.providerMetadata?.meta
        ?.redactedData
      expect(encrypted).toEqual(expect.stringMatching(/\S/))
      const next = LLMRequest.update(request, {
        toolChoice: ToolChoice.make("none"),
        messages: [
          ...request.messages,
          first.message,
          ...first.toolCalls.map((call) =>
            Message.tool({ id: call.id, name: call.name, result: { condition: "sunny" } }),
          ),
        ],
      })
      const replay = yield* compileRequest(next)
      expect(replay.body.messages[1].content).toEqual(
        expect.arrayContaining([
          { type: "redacted_thinking", data: encrypted },
          expect.objectContaining({ type: "tool_use", id: first.toolCalls[0]?.id }),
        ]),
      )
      expect(replay.body.messages[2].content).toMatchObject([
        { type: "tool_result", tool_use_id: first.toolCalls[0]?.id, content: '{"condition":"sunny"}' },
      ])
      expect(replay.body.tool_choice).toEqual({ type: "none" })
      const second = yield* LLMClient.generate(next)
      expect(second.text.toLowerCase()).toContain("sunny")
      expect(second.toolCalls).toHaveLength(0)
      expect(second.finishReason.normalized).toBe("stop")
    }),
  90_000,
)
