import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest, Message } from "../../src/index.js"
import { OpenRouter } from "../../src/providers/openrouter.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const recorded = recordedTests({
  prefix: "openrouter-responses",
  provider: "openrouter",
  protocol: "openrouter-responses",
  requires: ["OPENROUTER_API_KEY"],
})

recorded.effect.with(
  "continues Meta reasoning through a namespaced tool loop",
  { cassette: "openrouter-responses/openrouter-muse-spark-1-3-tool-loop", tags: ["reasoning", "tool-loop"] },
  () =>
    Effect.gen(function* () {
      const tool = {
        name: "lookup",
        description: "Look up a reference value",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      }
      const request = LLM.request({
        model: OpenRouter.configure({
          apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
          providerOptions: { reasoning: { effort: "minimal" } },
        }).model("meta/muse-spark-1.3"),
        prompt: "Call only crm.lookup once with query ping. Do not call inventory.lookup. Wait for the result.",
        tools: ["crm", "inventory"].map((name) => ({ type: "namespace", name, tools: [tool] })),
        generation: { maxTokens: 1536 },
      })
      const first = yield* LLMClient.generate(request)
      expect(first.toolCalls).toMatchObject([{ name: "lookup", namespace: "crm", input: { query: "ping" } }])
      const call = first.toolCalls[0]
      if (!call) throw new Error("Expected a namespaced tool call")
      const second = yield* LLMClient.generate(
        LLMRequest.update(request, {
          messages: [
            ...request.messages,
            first.message,
            Message.tool({ id: call.id, name: call.name, namespace: call.namespace, result: "pong" }),
            Message.user("Do not call tools again. Reply exactly pong."),
          ],
        }),
      )

      expect(second.toolCalls).toHaveLength(0)
      expect(second.text.trim()).toBe("pong")
    }),
  60_000,
)

recorded.effect(
  "preserves native hosted-search events",
  () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
            providerOptions: { reasoning: { effort: "low" } },
          }).model("x-ai/grok-4.3"),
          prompt:
            "Use web search once to find the official OpenRouter Responses API documentation. Reply with its URL.",
          generation: { maxTokens: 1536 },
          http: { body: { tools: [{ type: "web_search_preview", engine: "native", max_uses: 1 }], max_tool_calls: 1 } },
        }),
      )

      expect(response.toolCalls).toContainEqual(expect.objectContaining({ name: "web_search", providerExecuted: true }))
      expect(response.message.content).toContainEqual(
        expect.objectContaining({ type: "tool-result", name: "web_search", providerExecuted: true }),
      )
      expect(response.text.trim().length).toBeGreaterThan(0)
    }),
  60_000,
)
