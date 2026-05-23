import { expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import {
  LLM,
  LLMEvent,
  LLMResponse,
  Message,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  type FinishReason,
  type LLMRequest,
  type Model,
} from "../src"
import { LLMClient } from "../src/route"
import { tool } from "../src/tool"

export const weatherToolName = "get_weather"

// A deterministic system prompt long enough to clear every supported provider's
// minimum cacheable-prefix threshold (Anthropic Haiku 3.5: 2048 tokens; Anthropic
// Opus/Haiku 4.5: 4096 tokens; OpenAI/Gemini/Bedrock: lower). Built by repeating
// a fixed sentence — the cassette replays bit-for-bit, so the exact text matters
// only when re-recording with `RECORD=true`.
export const LARGE_CACHEABLE_SYSTEM = (() => {
  const sentence = "You are a concise, factual assistant. Answer precisely and avoid filler. Cite numbers when known. "
  // ~100 chars per sentence × 250 repeats ≈ 25,000 chars ≈ 5k+ tokens, safely
  // above every provider's threshold.
  return sentence.repeat(250)
})()

export const weatherTool = ToolDefinition.make({
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
      city === "Paris" ? { temperature: 22, condition: "sunny" } : { temperature: 0, condition: "unknown" },
    ),
})

export const weatherToolLoopRequest = (input: {
  readonly id: string
  readonly model: Model
  readonly system?: string
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: input.system ?? "Use the get_weather tool, then answer in one short sentence.",
    prompt: "What is the weather in Paris?",
    cache: "none",
    generation:
      input.temperature === false
        ? { maxTokens: input.maxTokens ?? 80 }
        : { maxTokens: input.maxTokens ?? 80, temperature: input.temperature ?? 0 },
  })

export const goldenWeatherToolLoopRequest = (input: {
  readonly id: string
  readonly model: Model
  readonly maxTokens?: number
  readonly temperature?: number | false
}) =>
  weatherToolLoopRequest({
    ...input,
    system: "Use the get_weather tool exactly once. After the tool result, reply exactly: Paris is sunny.",
  })

const RESTROOM_IMAGE_TEXT = "jiggling restroom prison"
const restroomImage = () =>
  Effect.promise(() => Bun.file(new URL("./fixtures/media/restroom.png", import.meta.url)).bytes()).pipe(
    Effect.map((bytes) => Buffer.from(bytes).toString("base64")),
  )

export const runWeatherToolLoop = (request: LLMRequest) =>
  LLMClient.stream({
    request,
    tools: { [weatherToolName]: weatherRuntimeTool },
    stopWhen: LLMClient.stepCountIs(10),
  }).pipe(
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  )

export const expectFinish = (
  events: ReadonlyArray<LLMEvent>,
  reason: Extract<LLMEvent, { readonly type: "finish" }>["reason"],
) => expect(events.at(-1)).toMatchObject({ type: "finish", reason })

export const expectWeatherToolCall = (response: LLMResponse) =>
  expect(response.toolCalls).toMatchObject([
    { type: "tool-call", id: expect.any(String), name: weatherToolName, input: { city: "Paris" } },
  ])

export const expectWeatherToolLoop = (events: ReadonlyArray<LLMEvent>) => {
  const finishes = events.filter(LLMEvent.is.finish)
  expect(finishes).toHaveLength(1)
  expect(finishes[0]?.reason).toBe("stop")

  const stepFinishes = events.filter(LLMEvent.is.stepFinish)
  expect(stepFinishes.map((event) => event.reason)).toEqual(["tool-calls", "stop"])

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

  const output = LLMResponse.text({ events })
  expect(output).toContain("Paris")
  expect(output.trim().length).toBeGreaterThan(0)
}

export const expectGoldenWeatherToolLoop = (events: ReadonlyArray<LLMEvent>) => {
  expectWeatherToolLoop(events)
  expect(LLMResponse.text({ events }).trim()).toMatch(/^Paris is sunny\.?$/)
}

export interface GoldenScenarioContext {
  readonly id: string
  readonly model: Model
  readonly maxTokens?: number
  readonly temperature?: number | false
}

const generate = (request: LLMRequest) => LLMClient.generate(request)

const generation = (context: GoldenScenarioContext, maxTokens: number) =>
  context.temperature === false ? { maxTokens } : { maxTokens, temperature: context.temperature ?? 0 }

const normalizeImageText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()

const encryptedReasoningOptions = {
  openai: {
    store: false,
    includeEncryptedReasoning: true,
    reasoningEffort: "low",
    reasoningSummary: "auto",
  },
} as const

type AssistantTextExpectation = string | RegExp

type UserStep = { readonly type: "user"; readonly content: Message.ContentInput }
type AssistantStep = {
  readonly type: "assistant"
  readonly text?: AssistantTextExpectation
  readonly toolCall?: { readonly name: string; readonly input: unknown }
  readonly reasoning?: "openai-encrypted"
  readonly id?: string
  readonly system?: string
  readonly maxTokens?: number
  readonly finish?: FinishReason
  readonly tools?: LLM.RequestInput["tools"]
  readonly toolChoice?: LLM.RequestInput["toolChoice"]
  readonly providerOptions?: LLMRequest["providerOptions"]
  readonly assert?: (response: LLMResponse) => void
}
type ConversationStep = UserStep | AssistantStep

const user = (content: Message.ContentInput): ConversationStep => ({ type: "user", content })

const assistant = {
  expectText: (
    text: AssistantTextExpectation,
    options?: Omit<AssistantStep, "type" | "text" | "reasoning" | "toolCall">,
  ): ConversationStep => ({ type: "assistant", text, ...options }),
  expectToolCall: (
    name: string,
    input: unknown,
    options?: Omit<AssistantStep, "type" | "text" | "reasoning" | "toolCall" | "finish">,
  ): ConversationStep => ({ type: "assistant", toolCall: { name, input }, finish: "tool-calls", ...options }),
  expectEncryptedReasoningText: (
    text: AssistantTextExpectation,
    options?: Omit<AssistantStep, "type" | "text" | "reasoning" | "toolCall" | "providerOptions">,
  ): ConversationStep => ({
    type: "assistant",
    text,
    reasoning: "openai-encrypted",
    providerOptions: encryptedReasoningOptions,
    ...options,
  }),
}

const assertAssistantText = (actual: string, expected: AssistantTextExpectation) => {
  if (typeof expected === "string") {
    expect(actual.trim()).toBe(expected)
    return
  }
  expect(actual.trim()).toMatch(expected)
}

const assertAssistantToolCall = (response: LLMResponse, expected: NonNullable<AssistantStep["toolCall"]>) => {
  expect(response.toolCalls).toMatchObject([
    { type: "tool-call", id: expect.any(String), name: expected.name, input: expected.input },
  ])
}

// The generated golden scenarios only model one assistant shape at a time:
// encrypted reasoning + text, text, or tool call. Keep mixed interleavings in
// focused protocol tests where event order can be asserted directly.
const assistantMessageFromResponse = (response: LLMResponse, step: AssistantStep) => {
  const content: ContentPart[] = []
  if (step.reasoning === "openai-encrypted") {
    const reasoning = response.events.find(
      (event): event is Extract<LLMEvent, { readonly type: "reasoning-end" }> =>
        LLMEvent.is.reasoningEnd(event) && typeof event.providerMetadata?.openai?.itemId === "string",
    )
    if (!reasoning) throw new Error("OpenAI Responses did not return reasoning metadata")
    expect(reasoning.providerMetadata?.openai?.reasoningEncryptedContent).toEqual(expect.any(String))
    content.push({ type: "reasoning", text: response.reasoning, providerMetadata: reasoning.providerMetadata })
  }

  if (response.text.length > 0) content.push({ type: "text", text: response.text })
  content.push(...response.toolCalls)
  return Message.assistant(content)
}

const runGeneratedConversation = (context: GoldenScenarioContext, steps: ReadonlyArray<ConversationStep>) =>
  Effect.gen(function* () {
    const messages: Message[] = []
    let generated = 0
    for (const step of steps) {
      if (step.type === "user") {
        messages.push(Message.user(step.content))
        continue
      }

      generated += 1
      const response = yield* generate(
        LLM.request({
          id: step.id ? `${context.id}_${step.id}` : `${context.id}_${generated}`,
          model: context.model,
          system: step.system,
          cache: "none",
          messages,
          tools: step.tools,
          toolChoice: step.toolChoice,
          providerOptions: step.providerOptions,
          generation: generation(context, step.maxTokens ?? context.maxTokens ?? 80),
        }),
      )
      if (step.text !== undefined) assertAssistantText(response.text, step.text)
      if (step.toolCall) assertAssistantToolCall(response, step.toolCall)
      step.assert?.(response)
      expectFinish(response.events, step.finish ?? "stop")
      messages.push(assistantMessageFromResponse(response, step))
    }
  })

const runTextScenario = (context: GoldenScenarioContext) =>
  runGeneratedConversation(context, [
    user("Reply exactly with: Hello!"),
    assistant.expectText(/^Hello!?$/, {
      system: "You are concise.",
      maxTokens: context.maxTokens ?? 40,
      providerOptions:
        context.model.route.id === "gemini" ? { gemini: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
    }),
  ])

const runToolCallScenario = (context: GoldenScenarioContext) =>
  runGeneratedConversation(context, [
    user("Call get_weather with city exactly Paris."),
    assistant.expectToolCall(
      weatherToolName,
      { city: "Paris" },
      {
        system: "Call tools exactly as requested.",
        tools: [weatherTool],
        toolChoice: ToolChoice.make(weatherTool),
        maxTokens: context.maxTokens ?? 80,
      },
    ),
  ])

const runImageScenario = (context: GoldenScenarioContext) =>
  Effect.gen(function* () {
    yield* runGeneratedConversation(context, [
      user([
        {
          type: "text",
          text: "The image contains exactly three lowercase English words. Read them left to right and reply with only those words.",
        },
        { type: "media", mediaType: "image/png", data: yield* restroomImage() },
      ]),
      assistant.expectText(/.+/, {
        system: "Read images carefully. Reply only with the visible text.",
        maxTokens: context.maxTokens ?? 20,
        assert: (response) => expect(normalizeImageText(response.text)).toBe(RESTROOM_IMAGE_TEXT),
      }),
    ])
  })

// Reproduces a tool-result image round trip: a tool returns image bytes, and
// the next model turn must receive provider-native image content instead of a
// JSON-stringified base64 blob.
const screenshotToolName = "read_screenshot"
const runImageToolResultScenario = (context: GoldenScenarioContext) =>
  Effect.gen(function* () {
    const image = yield* restroomImage()
    const response = yield* generate(
      LLM.request({
        id: `${context.id}_image_tool_result`,
        model: context.model,
        system: "Read images carefully. Reply only with the visible text, lowercase, no punctuation.",
        cache: "none",
        generation: generation(context, context.maxTokens ?? 40),
        messages: [
          Message.user("Use the read_screenshot tool, then reply with the words shown."),
          Message.assistant([{ type: "tool-call", id: "call_screenshot_1", name: screenshotToolName, input: {} }]),
          Message.tool({
            id: "call_screenshot_1",
            name: screenshotToolName,
            resultType: "content",
            result: [
              { type: "text", text: "Image read successfully" },
              { type: "media", mediaType: "image/png", data: image },
            ],
          }),
        ],
        tools: [
          ToolDefinition.make({
            name: screenshotToolName,
            description: "Capture a screenshot of the current screen.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          }),
        ],
      }),
    )

    expectFinish(response.events, "stop")
    expect(normalizeImageText(response.text)).toBe(RESTROOM_IMAGE_TEXT)
  })

const runReasoningScenario = (context: GoldenScenarioContext) =>
  runGeneratedConversation(context, [
    user("Think briefly, then reply exactly with: Hello!"),
    assistant.expectText(/^Hello!?$/, {
      system: "Show concise reasoning when the provider supports visible reasoning summaries.",
      providerOptions: { openai: { reasoningEffort: "low", reasoningSummary: "auto" } },
      maxTokens: context.maxTokens ?? 120,
      assert: (response) => expect(response.usage?.reasoningTokens ?? 0).toBeGreaterThan(0),
    }),
  ])

const runReasoningContinuationScenario = (context: GoldenScenarioContext) =>
  runGeneratedConversation(context, [
    user("Think briefly, then reply exactly with: Hello!"),
    assistant.expectEncryptedReasoningText(/^Hello!?$/, {
      id: "first",
      system: "Show concise reasoning when the provider supports visible reasoning summaries.",
      maxTokens: context.maxTokens ?? 120,
    }),
    user("Now reply exactly with: Done."),
    assistant.expectText(/^Done\.?$/, { id: "second", maxTokens: 40, providerOptions: encryptedReasoningOptions }),
  ])

const runToolLoopScenario = (context: GoldenScenarioContext) =>
  Effect.gen(function* () {
    expectGoldenWeatherToolLoop(
      yield* runWeatherToolLoop(
        goldenWeatherToolLoopRequest({
          id: context.id,
          model: context.model,
          maxTokens: context.maxTokens ?? 80,
          temperature: context.temperature,
        }),
      ),
    )
  })

const goldenScenarios = {
  text: { title: "streams text", tags: ["text", "golden"], run: runTextScenario },
  "tool-call": { title: "streams tool call", tags: ["tool", "tool-call", "golden"], run: runToolCallScenario },
  "tool-loop": { title: "drives a tool loop", tags: ["tool", "tool-loop", "golden"], run: runToolLoopScenario },
  image: { title: "reads image text", tags: ["media", "image", "vision", "golden"], run: runImageScenario },
  "image-tool-result": {
    title: "reads image returned from tool result",
    tags: ["media", "image", "vision", "tool", "tool-result", "golden"],
    run: runImageToolResultScenario,
  },
  reasoning: { title: "uses reasoning", tags: ["reasoning", "golden"], run: runReasoningScenario },
  "reasoning-continuation": {
    title: "continues encrypted reasoning",
    tags: ["reasoning", "continuation", "encrypted-reasoning", "golden"],
    run: runReasoningContinuationScenario,
  },
} as const

export type GoldenScenarioID = keyof typeof goldenScenarios
export const goldenScenarioTitle = (id: GoldenScenarioID) => goldenScenarios[id].title
export const goldenScenarioTags = (id: GoldenScenarioID) => [...goldenScenarios[id].tags]
export const runGoldenScenario = (id: GoldenScenarioID, context: GoldenScenarioContext) =>
  goldenScenarios[id].run(context)

const usageSummary = (usage: LLMResponse["usage"] | undefined) => {
  if (!usage) return undefined
  return Object.fromEntries(
    [
      ["inputTokens", usage.inputTokens],
      ["outputTokens", usage.outputTokens],
      ["reasoningTokens", usage.reasoningTokens],
      ["cacheReadInputTokens", usage.cacheReadInputTokens],
      ["cacheWriteInputTokens", usage.cacheWriteInputTokens],
      ["totalTokens", usage.totalTokens],
    ].filter((entry) => entry[1] !== undefined),
  )
}

const pushText = (summary: Array<Record<string, unknown>>, type: "text" | "reasoning", value: string) => {
  const last = summary.at(-1)
  if (last?.type === type) {
    last.value = `${typeof last.value === "string" ? last.value : ""}${value}`
    return
  }
  summary.push({ type, value })
}

export const eventSummary = (events: ReadonlyArray<LLMEvent>) => {
  const summary: Array<Record<string, unknown>> = []
  for (const event of events) {
    if (event.type === "text-delta") {
      pushText(summary, "text", event.text)
      continue
    }
    if (event.type === "reasoning-delta") {
      pushText(summary, "reasoning", event.text)
      continue
    }
    if (event.type === "tool-call") {
      summary.push({
        type: "tool-call",
        name: event.name,
        input: event.input,
        providerExecuted: event.providerExecuted,
      })
      continue
    }
    if (event.type === "tool-result") {
      summary.push({
        type: "tool-result",
        name: event.name,
        result: event.result,
        providerExecuted: event.providerExecuted,
      })
      continue
    }
    if (event.type === "tool-error") {
      summary.push({ type: "tool-error", name: event.name, message: event.message })
      continue
    }
    if (event.type === "finish") {
      summary.push({ type: "finish", reason: event.reason, usage: usageSummary(event.usage) })
    }
  }
  return summary.map((item) => Object.fromEntries(Object.entries(item).filter((entry) => entry[1] !== undefined)))
}
