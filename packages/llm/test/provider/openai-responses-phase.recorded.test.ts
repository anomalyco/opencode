import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, Message } from "../../src"
import * as OpenAI from "../../src/providers/openai"
import { OpenAIResponses } from "../../src/protocols/openai-responses"
import { LLMClient } from "../../src/route"
import { weatherTool } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = OpenAI.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
}).responses("gpt-5.6-sol")

const recorded = recordedTests({
  prefix: "openai-responses-phase",
  provider: "openai",
  protocol: "openai-responses",
  requires: ["OPENAI_API_KEY"],
})

describe("OpenAI Responses phase recorded", () => {
  recorded.effect.with("round-trips commentary into a final answer", { tags: ["phase", "tool"] }, () =>
    Effect.gen(function* () {
      const user = Message.user("What is the weather in Paris?")
      const first = yield* LLMClient.generate(
        LLM.request({
          model,
          system:
            "Before calling get_weather, briefly tell the user you are checking. Then call get_weather exactly once. Do not provide the final answer until its result is available.",
          messages: [user],
          tools: [weatherTool],
          generation: { maxTokens: 100 },
        }),
      )
      const call = first.toolCalls[0]
      if (!call) throw new Error("OpenAI Responses did not return the expected weather tool call")

      expect(call).toMatchObject({ name: "get_weather", input: { city: "Paris" } })
      const commentary = first.message.content.find(
        (part) => part.type === "text" && part.providerMetadata?.openai?.phase === "commentary",
      )
      if (!commentary || commentary.type !== "text") throw new Error("OpenAI Responses did not return commentary text")
      const itemID = commentary.providerMetadata?.openai?.itemId
      if (typeof itemID !== "string") throw new Error("OpenAI Responses commentary did not include an item ID")
      expect(commentary).toEqual({
        type: "text",
        text: "I’ll check the current weather in Paris.",
        providerMetadata: {
          openai: { itemId: itemID, phase: "commentary", status: "completed", annotations: [] },
        },
      })

      const continuation = LLM.request({
        model,
        system:
          "Before calling get_weather, briefly tell the user you are checking. Then call get_weather exactly once. After its result, answer exactly: Paris is sunny.",
        messages: [
          user,
          first.message,
          Message.tool({
            id: call.id,
            name: call.name,
            result: { temperature: 22, condition: "sunny" },
          }),
        ],
        tools: [weatherTool],
        generation: { maxTokens: 100 },
      })
      const prepared = yield* LLMClient.prepare<OpenAIResponses.OpenAIResponsesBody>(continuation)
      expect(prepared.body.input).toContainEqual({
        type: "message",
        id: itemID,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: commentary.text, annotations: [] }],
        phase: "commentary",
      })

      const second = yield* LLMClient.generate(continuation)

      expect(second.text.trim()).toBe("Paris is sunny.")
      expect(
        second.message.content.some(
          (part) => part.type === "text" && part.providerMetadata?.openai?.phase === "final_answer",
        ),
      ).toBeTrue()
    }),
  )
})
