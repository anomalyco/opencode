import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest, Message, ToolChoice, ToolDefinition } from "../../src/index.js"
import { AmazonBedrockMantle } from "../../src/providers.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const recorded = recordedTests({
  prefix: "bedrock-mantle-replay",
  provider: "amazon-bedrock",
  protocol: "openai-responses",
  requires: ["AWS_BEARER_TOKEN_BEDROCK"],
  tags: ["continuation", "tool-loop"],
})

for (const id of ["openai.gpt-oss-120b", "openai.gpt-oss-20b"]) {
  recorded.effect.with(
    `${id} continues text and tools after switching effort`,
    { metadata: { model: id } },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: AmazonBedrockMantle.configure({
            apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
            region: "us-east-1",
          }).responses(id),
          prompt: 'Reply with exactly "OK".',
          generation: { maxTokens: 512 },
        })
        const first = yield* LLMClient.generate(request)
        expect(first.text.trim()).toBe("OK")

        const low = LLMRequest.update(request, {
          messages: [...request.messages, first.message, Message.user('Now reply with exactly "TEST".')],
          providerOptions: { reasoningEffort: "low" },
        })
        const prepared = yield* compileRequest(low)
        expect(prepared.body.input).toEqual(
          expect.arrayContaining([expect.objectContaining({ role: "assistant", content: "OK" })]),
        )
        const second = yield* LLMClient.generate(low)
        expect(second.text.trim()).toBe("TEST")

        const toolRequest = LLMRequest.update(low, {
          messages: [
            ...low.messages,
            second.message,
            Message.user("Call lookup_code. After the tool returns, reply with exactly the returned code."),
          ],
          tools: [
            ToolDefinition.make({
              name: "lookup_code",
              description: "Return the code to reply with",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            }),
          ],
          toolChoice: ToolChoice.make("auto"),
        })
        const third = yield* LLMClient.generate(toolRequest)
        expect(third.toolCalls).toHaveLength(1)
        expect(third.toolCalls[0]?.name).toBe("lookup_code")
        expect(third.finishReason.normalized).toBe("tool-calls")

        const fourth = yield* LLMClient.generate(
          LLMRequest.update(toolRequest, {
            messages: [
              ...toolRequest.messages,
              third.message,
              ...third.toolCalls.map((call) =>
                Message.tool({ id: call.id, name: call.name, result: { type: "text", value: "DONE" } }),
              ),
            ],
            toolChoice: ToolChoice.make("none"),
          }),
        )
        expect(fourth.text.trim()).toBe("DONE")
        expect(fourth.finishReason.normalized).toBe("stop")
      }),
    120_000,
  )
}
