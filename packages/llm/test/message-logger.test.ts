import { describe, expect, test } from "bun:test"
import { Effect, Layer, Logger, LogLevel } from "effect"
import { LLMClient, MessageLogger } from "../src/route"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { LLM, LLMRequest, Message, Model } from "../src"
import { dynamicResponse } from "./lib/http"
import { deltaChunk, finishChunk } from "./lib/openai-chunks"
import { sseRaw } from "./lib/sse"
import { it } from "./lib/effect"

const chatRoute = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.openai.test/v1" } })
const model = Model.make({ id: "gpt-4o-mini", provider: "openai", route: chatRoute })

describe("MessageLogger", () => {
  describe("formatMessages", () => {
    test("formats system and user messages", () => {
      const request = LLM.request({
        model,
        system: "You are helpful.",
        prompt: "Say hello.",
      })
      const formatted = MessageLogger.formatMessages(request)
      expect(formatted).toContain("system: You are helpful.")
      expect(formatted).toContain("user: Say hello.")
    })

    test("formats messages with tool calls and results", () => {
      const request = LLM.request({
        model,
        messages: [
          Message.user("Check weather"),
          Message.assistant([
            { type: "tool-call", id: "call_1", name: "get_weather", input: { city: "Tokyo" } },
          ]),
          Message.tool({ id: "call_1", name: "get_weather", result: { temperature: 72 } }),
        ],
      })
      const formatted = MessageLogger.formatMessages(request)
      expect(formatted).toContain('tool-call(get_weather): {"city":"Tokyo"}')
      expect(formatted).toContain('tool-result(get_weather): {"type":"json","value":{"temperature":72}}')
    })
  })

  describe("formatEvents", () => {
    test("formats text deltas and usage", () => {
      const formatted = MessageLogger.formatEvents([
        { type: "text-delta", id: "text-0", text: "Hello" },
        { type: "text-delta", id: "text-0", text: " world" },
        { type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 5, visibleOutputTokens: 3 } },
      ])
      expect(formatted).toBe("Hello worldusage: {\"inputTokens\":10,\"outputTokens\":5,\"visibleOutputTokens\":3}")
    })

    test("formats reasoning deltas", () => {
      const formatted = MessageLogger.formatEvents([
        { type: "reasoning-delta", id: "reason-0", text: "thinking step" },
      ])
      expect(formatted).toContain("[reasoning]: thinking step")
    })

    test("formats tool call events", () => {
      const formatted = MessageLogger.formatEvents([
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
      ])
      expect(formatted).toContain('tool-call(lookup): {"query":"weather"}')
    })
  })

  describe("LLMClient integration", () => {
    const helloResponse = sseRaw(
      `data: ${JSON.stringify(deltaChunk({ role: "assistant", content: "Hello" }))}`,
      `data: ${JSON.stringify(finishChunk("stop"))}`,
    )

    it.effect("does not log when metadata.logMessages is not set", () =>
      Effect.gen(function* () {
        const result = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." }))
        expect(result.text).toBe("Hello")
      }).pipe(Effect.provide(dynamicResponse((input) => Effect.succeed(input.respond(helloResponse))))),
    )

    it.effect("logs request when metadata.logMessages is set to info", () =>
      Effect.gen(function* () {
        const result = yield* LLMClient.generate(
          LLM.request({ model, prompt: "Say hello.", metadata: { logMessages: "info" as const } }),
        )
        expect(result.text).toBe("Hello")
      }).pipe(Effect.provide(dynamicResponse((input) => Effect.succeed(input.respond(helloResponse))))),
    )
  })
})
