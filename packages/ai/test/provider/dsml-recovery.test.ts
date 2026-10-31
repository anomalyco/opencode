import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LanguageModel, LLM, LLMClient, LLMEvent, LLMRequest, ToolDefinition } from "../../src/effect.js"
import * as DeepSeek from "../../src/providers/deepseek.js"
import * as OpenAICompatible from "../../src/providers/openai-compatible.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { deltaChunk } from "../lib/openai-chunks.js"
import { sseEvents } from "../lib/sse.js"

const tool = ToolDefinition.make({ name: "shell", description: "Run a command", inputSchema: { type: "object" } })

const deepseek = DeepSeek.configure({ apiKey: "test" }).model("deepseek-v4.1-flash")
const lane = OpenAICompatible.configure({ baseURL: "https://api.lane.test/v1", apiKey: "test" }).model(
  "deepseek-v4.1-flash",
)
const other = OpenAICompatible.configure({ baseURL: "https://api.lane.test/v1", apiKey: "test" }).model("other-model")

const request = (model: Parameters<typeof LLM.request>[0]["model"]) =>
  LLM.request({ model, prompt: "Run it.", tools: [tool] })

const generate = (model: Parameters<typeof LLM.request>[0]["model"], ...contents: ReadonlyArray<object>) =>
  LLMClient.generate(request(model)).pipe(Effect.provide(fixedResponse(sseEvents(...contents))))

const toolCalls = (events: ReadonlyArray<LLMEvent>) => events.filter(LLMEvent.is.toolCall)

const V41_BLOCK = `<｜DSML｜ calls>
<｜DSML｜ invoke name="shell">
<｜DSML｜ parameter name="command" string="true">bun test</｜DSML｜ parameter>
<｜DSML｜ parameter name="timeout" string="false">2400000</｜DSML｜ parameter>
</｜DSML｜ invoke>
</｜DSML｜ calls>`

describe("OpenAI Chat DSML recovery", () => {
  it.effect("recovers a V4.1 wrapped block streamed inside the text channel", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({ role: "assistant", content: "Running now." }),
        deltaChunk({ content: V41_BLOCK }),
        deltaChunk({}, "stop"),
      )

      expect(response.text).toBe("Running now.")
      const calls = toolCalls(response.events)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("shell")
      expect(calls[0].input).toEqual({ command: "bun test", timeout: 2400000 })
      expect(response.finishReason).toEqual({ normalized: "tool-calls", raw: "stop" })
      expect(response.message.content.some((part) => part.type === "tool-call")).toBe(true)
    }),
  )

  it.effect("recovers across chunk boundaries that split the markup markers", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        lane,
        deltaChunk({ content: "Here:" }),
        deltaChunk({ content: "<｜DS" }),
        deltaChunk({
          content: `ML｜function_calls><｜DSML｜invoke name="shell"><｜DSML｜parameter name="command" string="true">ls</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>`,
        }),
        deltaChunk({}, "stop"),
      )

      expect(response.text).toBe("Here:")
      const calls = toolCalls(response.events)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("shell")
      expect(calls[0].input).toEqual({ command: "ls" })
    }),
  )

  it.effect("recovers a standalone invoke whose wrapper opener never arrived", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({
          content: `<｜DSML｜ invoke name="shell">
<｜DSML｜ parameter name="command" string="true">grep -r foo</｜DSML｜ parameter>
</｜DSML｜ invoke>`,
        }),
        deltaChunk({}, "stop"),
      )

      expect(response.text).toBe("")
      const calls = toolCalls(response.events)
      expect(calls).toHaveLength(1)
      expect(calls[0].input).toEqual({ command: "grep -r foo" })
    }),
  )

  it.effect("parses bare JSON invoke bodies and direct-JSON parameters", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({
          content: `<｜DSML｜function_calls><｜DSML｜invoke name="shell">{ "command": "bun install" }</｜DSML｜invoke></｜DSML｜function_calls>`,
        }),
        deltaChunk({}, "stop"),
      )

      expect(toolCalls(response.events)[0].input).toEqual({ command: "bun install" })
    }),
  )

  it.effect("emits a tool input error when recovered arguments do not decode", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({
          content: `<｜DSML｜invoke name="shell">not json at all</｜DSML｜invoke>`,
        }),
        deltaChunk({}, "stop"),
      )

      const errors = response.events.filter(LLMEvent.is.toolInputError)
      expect(errors).toHaveLength(1)
      expect(errors[0].name).toBe("shell")
      expect(errors[0].raw).toBe("not json at all")
      expect(toolCalls(response.events)).toHaveLength(0)
    }),
  )

  it.effect("recovers complete invokes from a block truncated by the output limit", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({
          content: `<｜DSML｜tool_calls><｜DSML｜invoke name="shell"><｜DSML｜parameter name="command" string="true">ls</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_`,
        }),
        deltaChunk({}, "length"),
      )

      const calls = toolCalls(response.events)
      expect(calls).toHaveLength(1)
      expect(calls[0].input).toEqual({ command: "ls" })
      expect(response.finishReason?.normalized).toBe("length")
    }),
  )

  it.effect("strips orphan closer tags from text without inventing tool calls", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({ content: `<parameter name="grep">\n</｜DSML｜invoke>\n</｜DSML｜calls>` }),
        deltaChunk({}, "stop"),
      )

      expect(toolCalls(response.events)).toHaveLength(0)
      expect(response.text).toBe(`<parameter name="grep">\n\n`)
    }),
  )

  it.effect("recovers sequential blocks with distinct call ids", () =>
    Effect.gen(function* () {
      const block = (name: string, command: string) =>
        `<｜DSML｜tool_calls><｜DSML｜invoke name="${name}"><｜DSML｜parameter name="command" string="true">${command}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>`
      const response = yield* generate(
        deepseek,
        deltaChunk({ content: `${block("shell", "ls")}${block("shell", "pwd")}` }),
        deltaChunk({}, "stop"),
      )

      const calls = toolCalls(response.events)
      expect(calls.map((call) => call.id)).toHaveLength(2)
      expect(calls[0].id).not.toBe(calls[1].id)
      expect(calls.map((call) => call.input)).toEqual([{ command: "ls" }, { command: "pwd" }])
    }),
  )

  it.effect("does not reuse recovered call ids across responses", () =>
    Effect.gen(function* () {
      const first = yield* generate(deepseek, deltaChunk({ content: V41_BLOCK }), deltaChunk({}, "stop"))
      const second = yield* generate(deepseek, deltaChunk({ content: V41_BLOCK }), deltaChunk({}, "stop"))

      expect(toolCalls(first.events)[0].id).toMatch(/^tool_[0-9a-f]{32}$/)
      expect(toolCalls(first.events)[0].id).not.toBe(toolCalls(second.events)[0].id)
    }),
  )

  it.effect("upgrades the finish reason for calls recovered at end of stream", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({
          content: `<｜DSML｜ calls><｜DSML｜ invoke name="shell"><｜DSML｜ parameter name="command" string="true">ls</｜DSML｜ parameter></｜DSML｜ invoke>`,
        }),
        deltaChunk({}, "stop"),
      )

      const calls = toolCalls(response.events)
      expect(calls).toHaveLength(1)
      expect(calls[0].input).toEqual({ command: "ls" })
      expect(response.finishReason).toEqual({ normalized: "tool-calls", raw: "stop" })
    }),
  )

  it.effect("publishes text withheld by the tag-prefix holdback at end of stream", () =>
    Effect.gen(function* () {
      const response = yield* generate(deepseek, deltaChunk({ content: "compare 1 <" }), deltaChunk({}, "stop"))

      expect(response.text).toBe("compare 1 <")
      expect(toolCalls(response.events)).toHaveLength(0)
    }),
  )

  it.effect("passes content through unchanged when recovery is disabled", () =>
    Effect.gen(function* () {
      const response = yield* generate(other, deltaChunk({ content: V41_BLOCK }), deltaChunk({}, "stop"))

      expect(response.text).toBe(V41_BLOCK)
      expect(toolCalls(response.events)).toHaveLength(0)
      expect(response.finishReason).toEqual({ normalized: "stop", raw: "stop" })
    }),
  )

  it.effect("opts non-DeepSeek lanes in through the compatibility flag", () =>
    Effect.gen(function* () {
      const flagged = LanguageModel.update(other, { compatibility: { dsmlRecovery: true } })
      const response = yield* generate(flagged, deltaChunk({ content: V41_BLOCK }), deltaChunk({}, "stop"))

      const calls = toolCalls(response.events)
      expect(calls).toHaveLength(1)
      expect(calls[0].input).toEqual({ command: "bun test", timeout: 2400000 })
    }),
  )

  it.effect("tolerates ASCII pipe delimiters", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({
          content: `<|DSML| calls><|DSML| invoke name="shell"><|DSML| parameter name="command" string="true">ls</|DSML| parameter></|DSML| invoke></|DSML| calls>`,
        }),
        deltaChunk({}, "stop"),
      )

      expect(toolCalls(response.events)[0].input).toEqual({ command: "ls" })
    }),
  )

  it.effect("keeps ordinary angle brackets out of the recovery path", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        deepseek,
        deltaChunk({ content: "compare 1 < 2 and use <b>bold</b> tags" }),
        deltaChunk({}, "stop"),
      )

      expect(response.text).toBe("compare 1 < 2 and use <b>bold</b> tags")
      expect(toolCalls(response.events)).toHaveLength(0)
    }),
  )

  it.effect("leaves requests without tools untouched even for DeepSeek", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(LLM.request({ model: deepseek, prompt: "Explain." })).pipe(
        Effect.provide(fixedResponse(sseEvents(deltaChunk({ content: V41_BLOCK }), deltaChunk({}, "stop")))),
      )

      expect(response.text).toBe(V41_BLOCK)
      expect(toolCalls(response.events)).toHaveLength(0)
    }),
  )
})
