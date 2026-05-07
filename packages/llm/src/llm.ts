import {
  LLMClient,
  modelCapabilities,
  modelLimits,
  modelRef,
  type ModelCapabilitiesInput,
  type ModelRefInput,
} from "./route/client"
import {
  GenerationOptions,
  HttpOptions,
  LLMRequest,
  Message,
  SystemPart,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  ToolCallPart,
  ToolResultPart,
} from "./schema"

export type CapabilitiesInput = ModelCapabilitiesInput

export type ModelInput = ModelRefInput

export type MessageInput = Message.Input

export type ToolChoiceInput = ToolChoice.Input
export type ToolChoiceMode = ToolChoice.Mode

export type ToolResultInput = Parameters<typeof ToolResultPart.make>[0]

/** Input accepted by `LLM.request`, normalized into the canonical `LLMRequest` class. */
export type RequestInput = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  "system" | "messages" | "tools" | "toolChoice" | "generation" | "http" | "providerOptions"
> & {
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>
  readonly messages?: ReadonlyArray<Message | MessageInput>
  readonly tools?: ReadonlyArray<ToolDefinition.Input>
  readonly toolChoice?: ToolChoiceInput
  readonly generation?: GenerationOptions.Input
  readonly providerOptions?: ConstructorParameters<typeof LLMRequest>[0]["providerOptions"]
  readonly http?: HttpOptions.Input
}

export const capabilities = modelCapabilities

export const limits = modelLimits

export const text = Message.text

export const system = SystemPart.make

export const message = Message.make

export const user = Message.user

export const assistant = Message.assistant

export const model = modelRef

export const toolDefinition = ToolDefinition.make

export const toolCall = ToolCallPart.make

export const toolResult = ToolResultPart.make

export const toolMessage = Message.tool

export const toolChoiceName = ToolChoice.named

export const toolChoice = ToolChoice.make

export const generation = GenerationOptions.make

export const generate = LLMClient.generate

export const stream = LLMClient.stream

export const stepCountIs = LLMClient.stepCountIs

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
    system: SystemPart.content(requestSystem),
    messages: [...(messages?.map(message) ?? []), ...(prompt === undefined ? [] : [user(prompt)])],
    tools: tools?.map(toolDefinition) ?? [],
    toolChoice: requestToolChoice ? toolChoice(requestToolChoice) : undefined,
    generation: requestGeneration === undefined ? undefined : generation(requestGeneration),
    providerOptions: requestProviderOptions,
    http: requestHttp === undefined ? undefined : HttpOptions.make(requestHttp),
  })
}

export const updateRequest = (input: LLMRequest, patch: Partial<RequestInput>) =>
  request({ ...requestInput(input), ...patch })
