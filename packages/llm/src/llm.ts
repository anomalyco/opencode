import {
  GenerationOptions,
  LLMRequest,
  LLMResponse,
  Message,
  ModelCapabilities,
  ModelLimits,
  ModelRef,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  type LLMEvent,
  type Protocol,
  type ReasoningEffort,
  type SystemPart,
  type ToolCallPart,
  type ToolResultPart,
  type ToolResultValue,
} from "./schema"

export type CapabilitiesInput = {
  readonly input?: Partial<ModelCapabilities["input"]>
  readonly output?: Partial<ModelCapabilities["output"]>
  readonly tools?: Partial<ModelCapabilities["tools"]>
  readonly cache?: Partial<ModelCapabilities["cache"]>
  readonly reasoning?: Partial<Omit<ModelCapabilities["reasoning"], "efforts">> & {
    readonly efforts?: ReadonlyArray<ReasoningEffort>
  }
}

export type ModelInput = Omit<ConstructorParameters<typeof ModelRef>[0], "capabilities" | "limits"> & {
  readonly capabilities?: ModelCapabilities | CapabilitiesInput
  readonly limits?: ModelLimits | ConstructorParameters<typeof ModelLimits>[0]
}

export type MessageInput = Omit<ConstructorParameters<typeof Message>[0], "content"> & {
  readonly content: string | ContentPart | ReadonlyArray<ContentPart>
}

export type ToolChoiceInput =
  | ToolChoice
  | ConstructorParameters<typeof ToolChoice>[0]
  | ToolDefinition
  | string

export type ToolResultInput = Omit<ToolResultPart, "type" | "result"> & {
  readonly result: ToolResultValue | unknown
  readonly resultType?: ToolResultValue["type"]
}

export type RequestInput = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  "system" | "messages" | "tools" | "toolChoice" | "generation"
> & {
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>
  readonly messages?: ReadonlyArray<Message | MessageInput>
  readonly tools?: ReadonlyArray<ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]>
  readonly toolChoice?: ToolChoiceInput
  readonly generation?: GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0]
}

export const capabilities = (input: CapabilitiesInput = {}) =>
  new ModelCapabilities({
    input: { text: true, image: false, audio: false, video: false, pdf: false, ...input.input },
    output: { text: true, reasoning: false, ...input.output },
    tools: { calls: false, streamingInput: false, providerExecuted: false, ...input.tools },
    cache: { prompt: false, messageBlocks: false, contentBlocks: false, ...input.cache },
    reasoning: { efforts: [], summaries: false, encryptedContent: false, ...input.reasoning },
  })

export const limits = (input: ConstructorParameters<typeof ModelLimits>[0] = {}) => new ModelLimits(input)

export const text = (value: string): ContentPart => ({ type: "text", text: value })

export const system = (value: string): SystemPart => ({ type: "text", text: value })

const contentParts = (input: string | ContentPart | ReadonlyArray<ContentPart>) =>
  typeof input === "string" ? [text(input)] : Array.isArray(input) ? [...input] : [input]

const systemParts = (input?: string | SystemPart | ReadonlyArray<SystemPart>) => {
  if (input === undefined) return []
  return typeof input === "string" ? [system(input)] : Array.isArray(input) ? [...input] : [input]
}

export const message = (input: Message | MessageInput) => {
  if (input instanceof Message) return input
  return new Message({ ...input, content: contentParts(input.content) })
}

export const user = (content: string | ContentPart | ReadonlyArray<ContentPart>) =>
  message({ role: "user", content })

export const assistant = (content: string | ContentPart | ReadonlyArray<ContentPart>) =>
  message({ role: "assistant", content })

export const model = (input: ModelInput) => {
  const { capabilities: modelCapabilities, limits: modelLimits, ...rest } = input
  return new ModelRef({
    ...rest,
    protocol: input.protocol as Protocol,
    capabilities: modelCapabilities instanceof ModelCapabilities ? modelCapabilities : capabilities(modelCapabilities),
    limits: modelLimits instanceof ModelLimits ? modelLimits : limits(modelLimits),
  })
}

export const tool = (input: ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]) => {
  if (input instanceof ToolDefinition) return input
  return new ToolDefinition(input)
}

export const toolCall = (input: Omit<ToolCallPart, "type">): ToolCallPart => ({ type: "tool-call", ...input })

const toolResultValue = (value: ToolResultValue | unknown, type: ToolResultValue["type"] = "json"): ToolResultValue => {
  if (typeof value === "object" && value !== null && "type" in value && "value" in value) return value as ToolResultValue
  return { type, value }
}

export const toolResult = (input: ToolResultInput): ToolResultPart => ({
  type: "tool-result",
  id: input.id,
  name: input.name,
  result: toolResultValue(input.result, input.resultType),
  metadata: input.metadata,
})

export const toolMessage = (input: ToolResultPart | ToolResultInput) =>
  message({ role: "tool", content: ["type" in input ? input : toolResult(input)] })

export const toolChoice = (input: ToolChoiceInput) => {
  if (input instanceof ToolChoice) return input
  if (input instanceof ToolDefinition) return new ToolChoice({ type: "tool", name: input.name })
  if (typeof input === "string") return new ToolChoice({ type: "tool", name: input })
  return new ToolChoice(input)
}

export const generation = (input: GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0] = {}) => {
  if (input instanceof GenerationOptions) return input
  return new GenerationOptions(input)
}

export const request = (input: RequestInput) => {
  const { system: requestSystem, prompt, messages, tools, toolChoice: requestToolChoice, generation: requestGeneration, ...rest } = input
  return new LLMRequest({
    ...rest,
    system: systemParts(requestSystem),
    messages: [...(messages?.map(message) ?? []), ...(prompt === undefined ? [] : [user(prompt)])],
    tools: tools?.map(tool) ?? [],
    toolChoice: requestToolChoice ? toolChoice(requestToolChoice) : undefined,
    generation: generation(requestGeneration),
  })
}

export const outputText = (response: LLMResponse | { readonly events: ReadonlyArray<LLMEvent> }) =>
  response.events
    .filter((event) => event.type === "text-delta")
    .map((event) => event.text)
    .join("")
