import { LLM, Message, ToolCallPart, ToolDefinition, ToolResultPart, type ContentPart, type Model } from "../src"

export const basicContinuation = ["system", "user-text", "assistant-text", "user-follow-up"] as const
export const toolContinuation = ["tool-call", "tool-result"] as const
export const reasoningContinuation = ["assistant-reasoning", "encrypted-reasoning"] as const
export const mediaContinuation = ["user-image"] as const
export const maximalContinuation = [
  ...basicContinuation,
  ...toolContinuation,
  ...reasoningContinuation,
  ...mediaContinuation,
] as const

export type ContinuationFeature = (typeof maximalContinuation)[number]

export const nativeOpenAIResponsesContinuation = [
  ...basicContinuation,
  ...toolContinuation,
  "encrypted-reasoning",
  ...mediaContinuation,
] as const satisfies ReadonlyArray<ContinuationFeature>

export const nativeAnthropicMessagesContinuation = [
  ...basicContinuation,
  ...toolContinuation,
  "assistant-reasoning",
  ...mediaContinuation,
] as const satisfies ReadonlyArray<ContinuationFeature>

export const continuationTool = ToolDefinition.make({
  name: "get_weather",
  description: "Get current weather for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  },
})

export function continuationRequest(input: {
  readonly id: string
  readonly model: Model
  readonly features: ReadonlyArray<ContinuationFeature>
  readonly image?: string
}) {
  const features = new Set(input.features)
  const messages = []
  const firstUser: ContentPart[] = []
  const firstAssistant: ContentPart[] = []

  if (features.has("user-text")) firstUser.push({ type: "text", text: "What is shown here?" })
  if (features.has("user-image"))
    firstUser.push({ type: "media", mediaType: "image/png", data: input.image ?? "AAECAw==" })
  if (firstUser.length > 0) messages.push(Message.user(firstUser))

  if (features.has("assistant-reasoning"))
    firstAssistant.push({
      type: "reasoning",
      text: "I inspected the previous turn.",
      providerMetadata: { anthropic: { signature: "sig_continuation_1" } },
    })
  if (features.has("encrypted-reasoning"))
    firstAssistant.push({
      type: "reasoning",
      text: "I inspected the previous turn.",
      providerMetadata: {
        openai: {
          itemId: "rs_continuation_1",
          reasoningEncryptedContent: "encrypted-continuation-state",
        },
      },
    })
  if (features.has("assistant-text")) firstAssistant.push({ type: "text", text: "It shows a small test image." })
  if (firstAssistant.length > 0) messages.push(Message.assistant(firstAssistant))

  if (features.has("tool-call")) {
    messages.push(Message.user("Check the weather in Paris before continuing."))
    messages.push(
      Message.assistant([ToolCallPart.make({ id: "call_weather_1", name: "get_weather", input: { city: "Paris" } })]),
    )
  }
  if (features.has("tool-result")) {
    messages.push(
      Message.tool(ToolResultPart.make({ id: "call_weather_1", name: "get_weather", result: { temperature: 22 } })),
    )
    if (features.has("assistant-text")) messages.push(Message.assistant("Paris is 22 degrees."))
  }
  if (features.has("user-follow-up"))
    messages.push(Message.user("Continue from this conversation in one short sentence."))

  return LLM.request({
    id: input.id,
    model: input.model,
    system: features.has("system") ? "You are concise. Continue from the provided history." : undefined,
    messages,
    tools: features.has("tool-call") ? [continuationTool] : [],
    cache: "none",
    providerOptions: features.has("encrypted-reasoning")
      ? { openai: { store: false, include: ["reasoning.encrypted_content"], reasoningSummary: "auto" } }
      : undefined,
    generation: { maxTokens: 80, temperature: 0 },
  })
}
