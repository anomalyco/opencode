import {
  GenerationOptions,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  ModelCapabilities,
  ModelID,
  ModelLimits,
  ModelRef,
  ProviderID,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  type ModelID as ModelIDType,
  type ProviderID as ProviderIDType,
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

export type ModelInput = Omit<ConstructorParameters<typeof ModelRef>[0], "id" | "provider" | "capabilities" | "limits"> & {
  readonly id: string | ModelIDType
  readonly provider: string | ProviderIDType
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
export type ToolChoiceMode = Exclude<ToolChoice["type"], "tool">

export type ToolResultInput = Omit<ToolResultPart, "type" | "result"> & {
  readonly result: unknown
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
    id: ModelID.make(input.id),
    provider: ProviderID.make(input.provider),
    protocol: input.protocol,
    capabilities: modelCapabilities instanceof ModelCapabilities ? modelCapabilities : capabilities(modelCapabilities),
    limits: modelLimits instanceof ModelLimits ? modelLimits : limits(modelLimits),
  })
}

export const toolDefinition = (input: ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]) => {
  if (input instanceof ToolDefinition) return input
  return new ToolDefinition(input)
}

export const toolCall = (input: Omit<ToolCallPart, "type">): ToolCallPart => ({ type: "tool-call", ...input })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isToolResultValue = (value: unknown): value is ToolResultValue =>
  isRecord(value) && (value.type === "text" || value.type === "json" || value.type === "error") && "value" in value

const toolResultValue = (value: unknown, type: ToolResultValue["type"] = "json"): ToolResultValue => {
  if (isToolResultValue(value)) return value
  return { type, value }
}

export const toolResult = (input: ToolResultInput): ToolResultPart => ({
  type: "tool-result",
  id: input.id,
  name: input.name,
  result: toolResultValue(input.result, input.resultType),
  providerExecuted: input.providerExecuted,
  metadata: input.metadata,
})

export const toolMessage = (input: ToolResultPart | ToolResultInput) =>
  message({ role: "tool", content: ["type" in input ? input : toolResult(input)] })

export const toolChoiceName = (name: string) => new ToolChoice({ type: "tool", name })

const isToolChoiceMode = (value: string): value is ToolChoiceMode =>
  value === "auto" || value === "none" || value === "required"

export const toolChoice = (input: ToolChoiceInput) => {
  if (input instanceof ToolChoice) return input
  if (input instanceof ToolDefinition) return new ToolChoice({ type: "tool", name: input.name })
  if (typeof input === "string") return isToolChoiceMode(input) ? new ToolChoice({ type: input }) : toolChoiceName(input)
  return new ToolChoice(input)
}

export const generation = (input: GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0] = {}) => {
  if (input instanceof GenerationOptions) return input
  return new GenerationOptions(input)
}

export const requestInput = (input: LLMRequest): RequestInput => ({
  id: input.id,
  model: input.model,
  system: input.system,
  messages: input.messages,
  tools: input.tools,
  toolChoice: input.toolChoice,
  generation: input.generation,
  reasoning: input.reasoning,
  cache: input.cache,
  responseFormat: input.responseFormat,
  metadata: input.metadata,
  native: input.native,
})

export const request = (input: RequestInput) => {
  const { system: requestSystem, prompt, messages, tools, toolChoice: requestToolChoice, generation: requestGeneration, ...rest } = input
  return new LLMRequest({
    ...rest,
    system: systemParts(requestSystem),
    messages: [...(messages?.map(message) ?? []), ...(prompt === undefined ? [] : [user(prompt)])],
    tools: tools?.map(toolDefinition) ?? [],
    toolChoice: requestToolChoice ? toolChoice(requestToolChoice) : undefined,
    generation: generation(requestGeneration),
  })
}

export const updateRequest = (input: LLMRequest, patch: Partial<RequestInput>) =>
  request({ ...requestInput(input), ...patch })

export const outputText = (response: LLMResponse | { readonly events: ReadonlyArray<LLMEvent> }) =>
  response.events
    .filter(LLMEvent.guards["text-delta"])
    .map((event) => event.text)
    .join("")

export const outputUsage = (response: LLMResponse | { readonly events: ReadonlyArray<LLMEvent> }) => {
  if (response instanceof LLMResponse) return response.usage
  return response.events.reduce<LLMResponse["usage"]>(
    (usage, event) => ("usage" in event && event.usage !== undefined ? event.usage : usage),
    undefined,
  )
}

export const outputToolCalls = (response: LLMResponse | { readonly events: ReadonlyArray<LLMEvent> }) =>
  response.events.filter(LLMEvent.guards["tool-call"])

export const outputReasoning = (response: LLMResponse | { readonly events: ReadonlyArray<LLMEvent> }) =>
  response.events
    .filter(LLMEvent.guards["reasoning-delta"])
    .map((event) => event.text)
    .join("")
