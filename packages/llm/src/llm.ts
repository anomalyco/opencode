import {
  modelCapabilities,
  modelLimits,
  modelRef,
  type ModelCapabilitiesInput,
  type ModelRefInput,
} from "./adapter/client"
import {
  GenerationOptions,
  HttpOptions,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  type SystemPart,
  ToolCallPart,
  ToolResultPart,
} from "./schema"

export type CapabilitiesInput = ModelCapabilitiesInput

export type ModelInput = ModelRefInput

export type MessageInput = Message.Input

export type ToolChoiceInput = ToolChoice | ConstructorParameters<typeof ToolChoice>[0] | ToolDefinition | string
export type ToolChoiceMode = Exclude<ToolChoice["type"], "tool">

export type ToolResultInput = Parameters<typeof ToolResultPart.make>[0]

export type RequestInput = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  "system" | "messages" | "tools" | "toolChoice" | "generation" | "http" | "providerOptions"
> & {
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>
  readonly messages?: ReadonlyArray<Message | MessageInput>
  readonly tools?: ReadonlyArray<ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]>
  readonly toolChoice?: ToolChoiceInput
  readonly generation?: GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0]
  readonly providerOptions?: ConstructorParameters<typeof LLMRequest>[0]["providerOptions"]
  readonly http?: HttpOptions | ConstructorParameters<typeof HttpOptions>[0]
}

export const capabilities = modelCapabilities

export const limits = modelLimits

export const text = Message.text

export const system = (value: string): SystemPart => ({ type: "text", text: value })

const systemParts = (input?: string | SystemPart | ReadonlyArray<SystemPart>) => {
  if (input === undefined) return []
  return typeof input === "string" ? [system(input)] : Array.isArray(input) ? [...input] : [input]
}

export const message = Message.make

export const user = Message.user

export const assistant = Message.assistant

export const model = modelRef

export const toolDefinition = (input: ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]) => {
  if (input instanceof ToolDefinition) return input
  return new ToolDefinition(input)
}

export const toolCall = ToolCallPart.make

export const toolResult = ToolResultPart.make

export const toolMessage = Message.tool

export const toolChoiceName = (name: string) => new ToolChoice({ type: "tool", name })

const isToolChoiceMode = (value: string): value is ToolChoiceMode =>
  value === "auto" || value === "none" || value === "required"

export const toolChoice = (input: ToolChoiceInput) => {
  if (input instanceof ToolChoice) return input
  if (input instanceof ToolDefinition) return new ToolChoice({ type: "tool", name: input.name })
  if (typeof input === "string")
    return isToolChoiceMode(input) ? new ToolChoice({ type: input }) : toolChoiceName(input)
  return new ToolChoice(input)
}

export const generation = (input: GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0] = {}) => {
  if (input instanceof GenerationOptions) return input
  return new GenerationOptions(input)
}

const http = (input: HttpOptions | ConstructorParameters<typeof HttpOptions>[0] | undefined) => {
  if (input === undefined || input instanceof HttpOptions) return input
  return new HttpOptions(input)
}

export const requestInput = (input: LLMRequest): RequestInput => ({
  ...LLMRequest.input(input),
})

export const request = (input: RequestInput) => {
  const {
    system: requestSystem,
    prompt,
    messages,
    tools,
    toolChoice: requestToolChoice,
    generation: requestGeneration,
    providerOptions: requestProviderOptions,
    http: requestHttp,
    ...rest
  } = input
  return new LLMRequest({
    ...rest,
    system: systemParts(requestSystem),
    messages: [...(messages?.map(message) ?? []), ...(prompt === undefined ? [] : [user(prompt)])],
    tools: tools?.map(toolDefinition) ?? [],
    toolChoice: requestToolChoice ? toolChoice(requestToolChoice) : undefined,
    generation: requestGeneration === undefined ? undefined : generation(requestGeneration),
    providerOptions: requestProviderOptions,
    http: http(requestHttp),
  })
}

export const updateRequest = (input: LLMRequest, patch: Partial<RequestInput>) =>
  request({ ...requestInput(input), ...patch })

export const outputText = (response: LLMResponse | { readonly events: ReadonlyArray<LLMEvent> }) =>
  response.events
    .filter(LLMEvent.is.textDelta)
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
  response.events.filter(LLMEvent.is.toolCall)

export const outputReasoning = (response: LLMResponse | { readonly events: ReadonlyArray<LLMEvent> }) =>
  response.events
    .filter(LLMEvent.is.reasoningDelta)
    .map((event) => event.text)
    .join("")
