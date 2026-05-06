import { Context, Effect, Layer, Stream } from "effect"
import {
  LLMClient,
  modelCapabilities,
  modelLimits,
  modelRef,
  preserveModelBinding,
  type ModelCapabilitiesInput,
  type ModelRefInput,
} from "./adapter"
import type { RequestExecutor } from "./executor"
import { type Tools } from "./tool"
import { ToolRuntime, type RunOptions } from "./tool-runtime"
import {
  GenerationOptions,
  CacheIntent,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  ReasoningIntent,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  type SystemPart,
  type ToolCallPart,
  type ToolResultPart,
  type ToolResultValue,
} from "./schema"
import type { LLMError } from "./schema"

export type StreamWithToolsInput<T extends Tools> = Omit<RequestInput, "tools"> & Omit<RunOptions<T>, "request">

export interface Runtime {
  readonly stream: (input: LLMRequest | RequestInput) => Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service>
  readonly generate: (input: LLMRequest | RequestInput) => Effect.Effect<LLMResponse, LLMError, RequestExecutor.Service>
  readonly streamWithTools: <T extends Tools>(
    input: StreamWithToolsInput<T>,
  ) => Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service>
}

export class Service extends Context.Service<Service, Runtime>()("@opencode/LLM") {}

const requestOf = (input: LLMRequest | RequestInput) => (input instanceof LLMRequest ? input : request(input))

export const make = (): Runtime => {
  const client = LLMClient.make()
  return {
    stream: (input) => client.stream(requestOf(input)),
    generate: (input) => client.generate(requestOf(input)),
    streamWithTools: (input) => {
      const { maxSteps, concurrency, stopWhen, tools, ...rest } = input
      return ToolRuntime.run(client, { request: request(rest), tools, maxSteps, concurrency, stopWhen })
    },
  }
}

export const layer = (): Layer.Layer<Service> => Layer.succeed(Service, Service.of(make()))

export const stream = (input: LLMRequest | RequestInput) =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Service).stream(input)
    }),
  )

export const generate = (input: LLMRequest | RequestInput) =>
  Effect.gen(function* () {
    return yield* (yield* Service).generate(input)
  })

export const streamWithTools = <T extends Tools>(input: StreamWithToolsInput<T>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Service).streamWithTools(input)
    }),
  )

export type CapabilitiesInput = ModelCapabilitiesInput

export type ModelInput = ModelRefInput

export type MessageInput = Omit<ConstructorParameters<typeof Message>[0], "content"> & {
  readonly content: string | ContentPart | ReadonlyArray<ContentPart>
}

export type ToolChoiceInput = ToolChoice | ConstructorParameters<typeof ToolChoice>[0] | ToolDefinition | string
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

export const capabilities = modelCapabilities

export const limits = modelLimits

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

export const user = (content: string | ContentPart | ReadonlyArray<ContentPart>) => message({ role: "user", content })

export const assistant = (content: string | ContentPart | ReadonlyArray<ContentPart>) =>
  message({ role: "assistant", content })

export const model = modelRef

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
  if (typeof input === "string")
    return isToolChoiceMode(input) ? new ToolChoice({ type: input }) : toolChoiceName(input)
  return new ToolChoice(input)
}

export const generation = (input: GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0] = {}) => {
  if (input instanceof GenerationOptions) return input
  return new GenerationOptions(input)
}

const reasoning = (input: ReasoningIntent | ConstructorParameters<typeof ReasoningIntent>[0] | undefined) => {
  if (input === undefined || input instanceof ReasoningIntent) return input
  return new ReasoningIntent(input)
}

const cache = (input: CacheIntent | ConstructorParameters<typeof CacheIntent>[0] | undefined) => {
  if (input === undefined || input instanceof CacheIntent) return input
  return new CacheIntent(input)
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
  const {
    system: requestSystem,
    prompt,
    messages,
    tools,
    toolChoice: requestToolChoice,
    generation: requestGeneration,
    ...rest
  } = input
  const result = new LLMRequest({
    ...rest,
    system: systemParts(requestSystem),
    messages: [...(messages?.map(message) ?? []), ...(prompt === undefined ? [] : [user(prompt)])],
    tools: tools?.map(toolDefinition) ?? [],
    toolChoice: requestToolChoice ? toolChoice(requestToolChoice) : undefined,
    generation: generation(requestGeneration),
    reasoning: reasoning(rest.reasoning),
    cache: cache(rest.cache),
  })
  preserveModelBinding(input.model, result.model)
  return result
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
