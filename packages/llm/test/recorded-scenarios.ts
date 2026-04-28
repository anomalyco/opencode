import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, type LLMEvent, type LLMResponse, type ModelRef } from "../src"
import { tool } from "../src/tool"

export const helloPrompt = "Reply with exactly: Hello!"
export const weatherPrompt = "Call get_weather with city exactly Paris."
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
    prompt: input.prompt ?? helloPrompt,
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
    prompt: weatherPrompt,
    tools: [weatherTool],
    toolChoice: LLM.toolChoice(weatherTool),
    generation: { maxTokens: input.maxTokens ?? 80, temperature: 0 },
  })

export const expectFinish = (
  events: ReadonlyArray<LLMEvent>,
  reason: Extract<LLMEvent, { readonly type: "request-finish" }>["reason"],
) => expect(events.at(-1)).toMatchObject({ type: "request-finish", reason })

export const expectWeatherToolCall = (response: LLMResponse) =>
  expect(LLM.outputToolCalls(response)).toEqual([
    { type: "tool-call", id: expect.any(String), name: weatherToolName, input: { city: "Paris" } },
  ])
