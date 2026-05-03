import { expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent, type LLMRequest, type LLMResponse, type ModelRef } from "../src"
import type { LLMClient } from "../src/adapter"
import { tool } from "../src/tool"
import { ToolRuntime } from "../src/tool-runtime"

export const weatherToolName = "get_weather"

export const weatherTool = LLM.toolDefinition({
  name: weatherToolName,
  description: "Get current weather for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  },
})

export const weatherRuntimeTool = tool({
  description: weatherTool.description,
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ temperature: Schema.Number, condition: Schema.String }),
  execute: ({ city }) =>
    Effect.succeed(
      city === "Paris"
        ? { temperature: 22, condition: "sunny" }
        : { temperature: 0, condition: "unknown" },
    ),
})

export const textRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly prompt?: string
  readonly maxTokens?: number
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "You are concise.",
    prompt: input.prompt ?? "Reply with exactly: Hello!",
    generation: { maxTokens: input.maxTokens ?? 20, temperature: 0 },
  })

export const weatherToolRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly maxTokens?: number
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "Call tools exactly as requested.",
    prompt: "Call get_weather with city exactly Paris.",
    tools: [weatherTool],
    toolChoice: LLM.toolChoice(weatherTool),
    generation: { maxTokens: input.maxTokens ?? 80, temperature: 0 },
  })

export const weatherToolLoopRequest = (input: {
  readonly id: string
  readonly model: ModelRef
  readonly system?: string
  readonly maxTokens?: number
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: input.system ?? "Use the get_weather tool, then answer in one short sentence.",
    prompt: "What is the weather in Paris?",
    generation: { maxTokens: input.maxTokens ?? 80, temperature: 0 },
  })

export const runWeatherToolLoop = (client: LLMClient, request: LLMRequest) =>
  ToolRuntime.run(client, { request, tools: { [weatherToolName]: weatherRuntimeTool } }).pipe(
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  )

export const expectFinish = (
  events: ReadonlyArray<LLMEvent>,
  reason: Extract<LLMEvent, { readonly type: "request-finish" }>["reason"],
) => expect(events.at(-1)).toMatchObject({ type: "request-finish", reason })

export const expectWeatherToolCall = (response: LLMResponse) =>
  expect(LLM.outputToolCalls(response)).toMatchObject([
    { type: "tool-call", id: expect.any(String), name: weatherToolName, input: { city: "Paris" } },
  ])

export const expectWeatherToolLoop = (events: ReadonlyArray<LLMEvent>) => {
  const finishes = events.filter(LLMEvent.is.requestFinish)
  expect(finishes).toHaveLength(2)
  expect(finishes[0]?.reason).toBe("tool-calls")
  expect(finishes.at(-1)?.reason).toBe("stop")

  const toolCalls = events.filter(LLMEvent.is.toolCall)
  expect(toolCalls).toHaveLength(1)
  expect(toolCalls[0]).toMatchObject({ type: "tool-call", name: weatherToolName, input: { city: "Paris" } })

  const toolResults = events.filter(LLMEvent.is.toolResult)
  expect(toolResults).toHaveLength(1)
  expect(toolResults[0]).toMatchObject({
    type: "tool-result",
    name: weatherToolName,
    result: { type: "json", value: { temperature: 22, condition: "sunny" } },
  })

  const output = LLM.outputText({ events })
  expect(output).toContain("Paris")
  expect(output.trim().length).toBeGreaterThan(0)
}
