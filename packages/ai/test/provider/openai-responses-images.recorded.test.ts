import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, Message } from "../../src"
import { OpenAI } from "../../src/providers"
import { recordedTests } from "../recorded-test"

const openai = OpenAI.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})

const recorded = recordedTests({
  prefix: "openai-responses-images",
  provider: "openai",
  protocol: "openai-responses",
  requires: ["OPENAI_API_KEY"],
})

describe("OpenAI Responses image generation recorded", () => {
  recorded.effect("generates and edits an image with the hosted tool", () =>
    Effect.gen(function* () {
      const initial = Message.user("Generate a simple flat black triangle centered on a plain white background.")
      const tools = [
        OpenAI.imageGeneration({
          action: "auto",
          quality: "low",
          size: "1024x1024",
          outputFormat: "jpeg",
          outputCompression: 10,
          partialImages: 0,
        }),
      ]
      const response = yield* LLM.generate(
        LLM.request({
          model: openai.responses("gpt-5-mini"),
          messages: [initial],
          tools,
          toolChoice: "image_generation",
        }),
      )

      const result = response.events.find(LLMEvent.is.toolResult)
      expect(result).toBeDefined()
      expect(result?.providerExecuted).toBe(true)
      expect(result?.result.type).toBe("content")
      if (result?.result.type !== "content") return
      expect(result.result.value).toHaveLength(1)
      expect(result.result.value[0]?.type).toBe("file")
      if (result.result.value[0]?.type !== "file") return
      expect(result.result.value[0].mime).toBe("image/jpeg")
      expect(result.result.value[0].uri.startsWith("data:image/jpeg;base64,")).toBe(true)

      const edited = yield* LLM.generate(
        LLM.request({
          model: openai.responses("gpt-5-mini"),
          messages: [initial, response.message, Message.user("Now make the triangle blue.")],
          tools,
          toolChoice: "image_generation",
        }),
      )
      const editedResult = edited.events.find(LLMEvent.is.toolResult)
      expect(editedResult?.result.type).toBe("content")
      if (editedResult?.result.type !== "content") return
      expect(editedResult.result.value[0]?.type).toBe("file")
    }),
  )
})
