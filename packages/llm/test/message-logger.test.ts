import { describe, expect, test } from "bun:test"
import { Effect, Layer, Logger, LogLevel, References } from "effect"
import { LLMClient, MessageLogger } from "../src/route"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { LLM, Message, Model } from "../src"
import { dynamicResponse } from "./lib/http"
import { deltaChunk, finishChunk } from "./lib/openai-chunks"
import { sseRaw } from "./lib/sse"
import { it } from "./lib/effect"

const chatRoute = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.openai.test/v1" } })
const model = Model.make({ id: "gpt-4o-mini", provider: "openai", route: chatRoute })

type LogEntry = { readonly level: LogLevel.LogLevel; readonly message: unknown }
type LabeledEntry = { readonly level: LogLevel.LogLevel; readonly payload: Record<string, unknown> }

const captureLogs = (entries: Array<LogEntry>) =>
  Logger.make((options) => {
    entries.push({ level: options.logLevel, message: options.message })
  })

const labeled = (entries: Array<LogEntry>, label: string): Array<LabeledEntry> =>
  entries
    .filter((entry) => Array.isArray(entry.message) && entry.message[0] === label)
    .map((entry) => ({ level: entry.level, payload: (entry.message as Array<unknown>)[1] as Record<string, unknown> }))

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
          Message.assistant([{ type: "tool-call", id: "call_1", name: "get_weather", input: { city: "Tokyo" } }]),
          Message.tool({ id: "call_1", name: "get_weather", result: { temperature: 72 } }),
        ],
      })
      const formatted = MessageLogger.formatMessages(request)
      expect(formatted).toContain('tool-call(get_weather): {"city":"Tokyo"}')
      expect(formatted).toContain('tool-result(get_weather): {"type":"json","value":{"temperature":72}}')
    })
  })

  describe("formatEvents", () => {
    test("formats text deltas and usage on separate lines", () => {
      const formatted = MessageLogger.formatEvents([
        { type: "text-delta", id: "text-0", text: "Hello" },
        { type: "text-delta", id: "text-0", text: " world" },
        { type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 5, visibleOutputTokens: 3 } },
      ])
      expect(formatted).toBe('Hello world\nusage: {"inputTokens":10,"outputTokens":5,"visibleOutputTokens":3}')
    })

    test("accumulates reasoning deltas under a single prefix", () => {
      const formatted = MessageLogger.formatEvents([
        { type: "reasoning-delta", id: "reason-0", text: "thinking" },
        { type: "reasoning-delta", id: "reason-0", text: " step" },
        { type: "text-delta", id: "text-0", text: "Answer" },
      ])
      expect(formatted).toBe("[reasoning]: thinking step\nAnswer")
    })

    test("separates deltas, tool events and usage with newlines", () => {
      const formatted = MessageLogger.formatEvents([
        { type: "text-delta", id: "text-0", text: "Hello" },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
        { type: "finish", reason: "stop" },
      ])
      expect(formatted).toBe('Hello\ntool-call(lookup): {"query":"weather"}')
    })
  })

  describe("LLMClient integration", () => {
    const helloResponse = sseRaw(
      `data: ${JSON.stringify(deltaChunk({ role: "assistant", content: "Hello" }))}`,
      `data: ${JSON.stringify(finishChunk("stop"))}`,
    )
    const streamedResponse = sseRaw(
      `data: ${JSON.stringify(deltaChunk({ role: "assistant", content: "Hello" }))}`,
      `data: ${JSON.stringify(deltaChunk({ role: "assistant", content: " world" }))}`,
      `data: ${JSON.stringify(finishChunk("stop"))}`,
    )

    it.effect("does not log when metadata.logMessages is not set", () =>
      Effect.gen(function* () {
        const entries: Array<LogEntry> = []
        const result = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
          Effect.provide(
            Layer.mergeAll(
              dynamicResponse((input) => Effect.succeed(input.respond(helloResponse))),
              Logger.layer([captureLogs(entries)]),
            ),
          ),
        )
        expect(result.text).toBe("Hello")
        expect(labeled(entries, "LLM request")).toEqual([])
        expect(labeled(entries, "LLM response")).toEqual([])
      }),
    )

    it.effect("logs the request and response once each at info", () =>
      Effect.gen(function* () {
        const entries: Array<LogEntry> = []
        const result = yield* LLMClient.generate(
          LLM.request({ model, prompt: "Say hello.", metadata: { logMessages: "info" } }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              dynamicResponse((input) => Effect.succeed(input.respond(helloResponse))),
              Logger.layer([captureLogs(entries)]),
            ),
          ),
        )
        expect(result.text).toBe("Hello")
        const requests = labeled(entries, "LLM request")
        expect(requests).toHaveLength(1)
        expect(requests[0].level).toBe("Info")
        expect(requests[0].payload).toMatchObject({
          model: "openai/gpt-4o-mini",
          messages: expect.stringContaining("user: Say hello."),
        })
        const responses = labeled(entries, "LLM response")
        expect(responses).toHaveLength(1)
        expect(responses[0].level).toBe("Info")
        expect(responses[0].payload).toMatchObject({ model: "openai/gpt-4o-mini", response: "Hello" })
      }),
    )

    it.effect("logs a single coalesced response for streamed deltas", () =>
      Effect.gen(function* () {
        const entries: Array<LogEntry> = []
        const result = yield* LLMClient.generate(
          LLM.request({ model, prompt: "Say hello.", metadata: { logMessages: "info" } }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              dynamicResponse((input) => Effect.succeed(input.respond(streamedResponse))),
              Logger.layer([captureLogs(entries)]),
            ),
          ),
        )
        expect(result.text).toBe("Hello world")
        const responses = labeled(entries, "LLM response")
        expect(responses).toHaveLength(1)
        expect(responses[0].payload).toMatchObject({ model: "openai/gpt-4o-mini", response: "Hello world" })
      }),
    )

    it.effect("logs generation params at debug level", () =>
      Effect.gen(function* () {
        const entries: Array<LogEntry> = []
        const result = yield* LLMClient.generate(
          LLM.request({
            model,
            prompt: "Say hello.",
            generation: { temperature: 0.3 },
            metadata: { logMessages: "debug" },
          }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              dynamicResponse((input) => Effect.succeed(input.respond(helloResponse))),
              Logger.layer([captureLogs(entries)]),
              Layer.succeed(References.MinimumLogLevel, "Trace"),
            ),
          ),
        )
        expect(result.text).toBe("Hello")
        const requests = labeled(entries, "LLM request")
        expect(requests).toHaveLength(1)
        expect(requests[0].level).toBe("Debug")
        expect(requests[0].payload).toMatchObject({
          model: "openai/gpt-4o-mini",
          generation: expect.objectContaining({ temperature: 0.3 }),
        })
      }),
    )

    it.effect("logs the raw request body at trace level", () =>
      Effect.gen(function* () {
        const entries: Array<LogEntry> = []
        const result = yield* LLMClient.generate(
          LLM.request({ model, prompt: "Say hello.", metadata: { logMessages: "trace" } }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              dynamicResponse((input) => Effect.succeed(input.respond(helloResponse))),
              Logger.layer([captureLogs(entries)]),
              Layer.succeed(References.MinimumLogLevel, "Trace"),
            ),
          ),
        )
        expect(result.text).toBe("Hello")
        const requests = labeled(entries, "LLM request")
        expect(requests).toHaveLength(1)
        expect(requests[0].level).toBe("Trace")
        expect(requests[0].payload).toMatchObject({ model: "openai/gpt-4o-mini" })
        expect(typeof requests[0].payload.body).toBe("string")
        expect(requests[0].payload.body).toContain('"messages"')
        const responses = labeled(entries, "LLM response")
        expect(responses).toHaveLength(1)
        expect(responses[0].level).toBe("Trace")
        expect(responses[0].payload).toMatchObject({ response: "Hello" })
      }),
    )
  })
})
