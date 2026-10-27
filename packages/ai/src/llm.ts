import { Effect, JsonSchema, Schema, Stream } from "effect"
import { tryRequest } from "./media-model.js"
import { LLMClient, Service, type StreamOptions } from "./route/client.js"
import {
  GenerationOptions,
  HttpOptions,
  InvalidProviderOutputError,
  AIError,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  LanguageModel,
  SystemPart,
  ToolChoice,
  ToolEntry,
  type ContentPart,
  type LanguageModelProviderOptions,
  type ToolEntryInput,
} from "./schema/index.js"
import { make as makeTool, toDefinitions, type ExecutableTools, type ToolSchema } from "./tool.js"
import { ToolRuntime } from "./tool-runtime.js"

/** Input accepted by `LLM.request`, normalized into the canonical `LLMRequest` class. */
export type RequestInput<SelectedLanguageModel extends LanguageModel = LanguageModel> = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  "model" | "system" | "messages" | "tools" | "toolChoice" | "generation" | "http" | "providerOptions"
> & {
  readonly model: SelectedLanguageModel
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>
  readonly messages?: ReadonlyArray<Message | Message.Input>
  readonly tools?: ReadonlyArray<ToolEntryInput>
  readonly toolChoice?: ToolChoice.Input
  readonly generation?: GenerationOptions.Input
  readonly providerOptions?: NoInfer<LanguageModelProviderOptions<SelectedLanguageModel>>
  readonly http?: HttpOptions.Input
}

export function generate<const Model extends LanguageModel>(
  input: RequestInput<Model> | LLMRequest,
  options?: StreamOptions,
): Effect.Effect<LLMResponse, AIError, Service>
export function generate(input: RequestInput | LLMRequest, options?: StreamOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => LLMClient.generate(request, options)))
}

export function stream<const Model extends LanguageModel>(
  input: RequestInput<Model> | LLMRequest,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError, Service>
export function stream(input: RequestInput | LLMRequest, options?: StreamOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => LLMClient.stream(request, options))))
}

export type LoopInput<SelectedLanguageModel extends LanguageModel = LanguageModel> = Omit<
  RequestInput<SelectedLanguageModel>,
  "tools"
> & {
  readonly tools: ExecutableTools
  /** Called after each step that has tool calls; returning `true` ends the loop without running them. */
  readonly until?: (state: { readonly steps: ReadonlyArray<LLMResponse> }) => boolean
}

/**
 * Stream model calls, running the model's tool calls between them, until a step has no client-executed tool calls,
 * reports a provider error, or `until` returns `true`. Each step's `step-start` and `step-finish` carry its step index.
 */
export function loop<const Model extends LanguageModel>(
  input: LoopInput<Model>,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError, Service>
export function loop(input: LoopInput, options?: StreamOptions) {
  const { tools, until, ...rest } = input
  const step = (request: LLMRequest, steps: ReadonlyArray<LLMResponse>): Stream.Stream<LLMEvent, AIError, Service> =>
    Stream.suspend(() => {
      const events: LLMEvent[] = []
      return LLMClient.stream(request, options).pipe(
        Stream.map((event) =>
          event.type === "step-start" || event.type === "step-finish" ? { ...event, index: steps.length } : event,
        ),
        Stream.tap((event) => Effect.sync(() => events.push(event))),
        Stream.concat(
          Stream.unwrap(
            Effect.gen(function* () {
              const response = LLMResponse.fromEvents(events)
              const calls = response?.toolCalls.filter((call) => call.providerExecuted !== true) ?? []
              if (!response || calls.length === 0 || events.some(LLMEvent.is.providerError)) return Stream.empty
              const done = [...steps, response]
              if (until?.({ steps: done })) return Stream.empty
              const results = yield* Effect.forEach(calls, (call) => ToolRuntime.dispatch(tools, call), {
                concurrency: "unbounded",
              })
              const next = LLMRequest.update(request, {
                messages: [
                  ...request.messages,
                  response.message,
                  ...calls.map((call, i) =>
                    Message.tool({
                      id: call.id,
                      name: call.name,
                      namespace: call.namespace,
                      result: results[i].result,
                      providerMetadata: call.providerMetadata,
                    }),
                  ),
                ],
              })
              return Stream.fromIterable(results.flatMap((result) => result.events)).pipe(
                Stream.concat(step(next, done)),
              )
            }),
          ),
        ),
      )
    })
  return Stream.unwrap(
    requestEffect({ ...rest, tools: toDefinitions(tools) }).pipe(Effect.map((request) => step(request, []))),
  )
}

const requestEffect = (input: RequestInput | LLMRequest) =>
  input instanceof LLMRequest ? Effect.succeed(input) : tryRequest(() => request(input))

export const request = <const SelectedLanguageModel extends LanguageModel>(
  input: RequestInput<SelectedLanguageModel>,
) => {
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
    messages: [...(messages?.map(Message.make) ?? []), ...(prompt === undefined ? [] : [Message.user(prompt)])],
    tools: tools?.map(ToolEntry.make) ?? [],
    toolChoice: requestToolChoice ? ToolChoice.make(requestToolChoice) : undefined,
    generation: requestGeneration === undefined ? undefined : GenerationOptions.make(requestGeneration),
    providerOptions: requestProviderOptions,
    http: HttpOptions.make(requestHttp),
  })
}

const GENERATE_OBJECT_TOOL_NAME = "generate_object"

const GENERATE_OBJECT_TOOL_DESCRIPTION = "Return the structured result by calling this tool."

type GenerateObjectBase<SelectedLanguageModel extends LanguageModel = LanguageModel> = Omit<
  RequestInput<SelectedLanguageModel>,
  "tools" | "toolChoice"
>

export class GenerateObjectResponse<T> {
  constructor(
    readonly object: T,
    readonly response: LLMResponse,
  ) {}

  get events() {
    return this.response.events
  }

  get usage() {
    return this.response.usage
  }
}

export interface GenerateObjectOptions<
  S extends ToolSchema<any>,
  SelectedLanguageModel extends LanguageModel = LanguageModel,
> extends GenerateObjectBase<SelectedLanguageModel> {
  readonly schema: S
}

export interface GenerateObjectDynamicOptions<SelectedLanguageModel extends LanguageModel = LanguageModel>
  extends GenerateObjectBase<SelectedLanguageModel> {
  /** Raw JSON Schema object describing the expected output shape. */
  readonly jsonSchema: JsonSchema.JsonSchema
}

const runGenerateObject = Effect.fn("LLM.generateObject")(function* (
  options: GenerateObjectBase,
  tool: ReturnType<typeof makeTool>,
) {
  const baseRequest = request(options)
  const generateRequest = LLMRequest.update(baseRequest, {
    tools: toDefinitions({ [GENERATE_OBJECT_TOOL_NAME]: tool }),
    toolChoice: ToolChoice.named(GENERATE_OBJECT_TOOL_NAME),
  })
  const response = yield* LLMClient.generate(generateRequest)
  const call = response.toolCalls.find((event) => event.name === GENERATE_OBJECT_TOOL_NAME)
  if (!call)
    return yield* new AIError({
      reason: new InvalidProviderOutputError({
        message: `generateObject: model did not call the forced \`${GENERATE_OBJECT_TOOL_NAME}\` tool`,
      }),
    })
  const object = yield* tool._decode(call.input).pipe(
    Effect.mapError(
      (error) =>
        new AIError({
          reason: new InvalidProviderOutputError({
            message: `generateObject: tool input failed schema decode: ${error.message}`,
            cause: error,
          }),
        }),
    ),
  )
  return new GenerateObjectResponse(object, response)
})

/**
 * Run a model and decode its output against `schema`. Works on every protocol
 * because it forces a synthetic tool call internally — provider-native JSON
 * modes are intentionally avoided so behaviour is uniform.
 *
 * Two input modes:
 *
 * 1. `schema: EffectSchema<T>` — `.object` is decoded and typed as `T`.
 *    Decode failures surface as `AIError`.
 * 2. `jsonSchema: JsonSchema.JsonSchema` — `.object` is `unknown`. Use when
 *    the schema is only available at runtime (MCP, plugin manifests). Caller validates.
 */
export function generateObject<const SelectedLanguageModel extends LanguageModel, S extends ToolSchema<any>>(
  options: GenerateObjectOptions<S, SelectedLanguageModel>,
): Effect.Effect<GenerateObjectResponse<Schema.Schema.Type<S>>, AIError, Service>
export function generateObject<const SelectedLanguageModel extends LanguageModel>(
  options: GenerateObjectDynamicOptions<SelectedLanguageModel>,
): Effect.Effect<GenerateObjectResponse<unknown>, AIError, Service>
export function generateObject(options: GenerateObjectOptions<ToolSchema<any>> | GenerateObjectDynamicOptions) {
  if ("schema" in options) {
    const { schema, ...rest } = options
    return runGenerateObject(
      rest,
      makeTool({
        description: GENERATE_OBJECT_TOOL_DESCRIPTION,
        parameters: schema,
        success: Schema.Unknown as ToolSchema<unknown>,
        execute: () => Effect.void,
      }),
    )
  }
  const { jsonSchema, ...rest } = options
  return runGenerateObject(
    rest,
    makeTool({
      description: GENERATE_OBJECT_TOOL_DESCRIPTION,
      jsonSchema,
      execute: () => Effect.void,
    }),
  )
}
