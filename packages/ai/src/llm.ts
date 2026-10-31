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
  type Finish,
  ToolChoice,
  ToolCallPart,
  ToolEntry,
  type ContentPart,
  type LanguageModelProviderOptions,
  type ToolEntryInput,
  withPartial,
} from "./schema/index.js"
import { tool, toDefinitions, type ExecutableTool, type Tool, type ToolSchema } from "./tool.js"
import { reject, ToolRuntime } from "./tool-runtime.js"

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

/** An Effect Schema decodes and types `object`; a raw JSON Schema leaves it `unknown`. */
export type OutputSchema = ToolSchema<any> | JsonSchema.JsonSchema

export type OutputType<S extends OutputSchema> = S extends Schema.Top ? Schema.Schema.Type<S> : unknown

export type ObjectInput<
  S extends OutputSchema,
  SelectedLanguageModel extends LanguageModel = LanguageModel,
> = RequestInput<SelectedLanguageModel> & { readonly schema: S }

export type ObjectResponse<T> = LLMResponse & { readonly object: T }

/** Stream events for a request with `schema`: the `finish` event carries the decoded `object`. */
export type ObjectEvent<T> = Exclude<LLMEvent, Finish> | (Finish & { readonly object: T })

/** Loop events for a request with `schema`: the final step's `finish` event carries the decoded `object`. */
export type LoopObjectEvent<T> = Exclude<LLMEvent, Finish> | (Finish & { readonly object?: T })

/** Run one model call. With `schema`, the model must answer through a forced tool call decoded into `object`. */
export function generate<const Model extends LanguageModel, S extends OutputSchema>(
  input: ObjectInput<S, Model>,
  options?: StreamOptions,
): Effect.Effect<ObjectResponse<OutputType<S>>, AIError, Service>
export function generate<const Model extends LanguageModel>(
  input: RequestInput<Model> | LLMRequest,
  options?: StreamOptions,
): Effect.Effect<LLMResponse, AIError, Service>
export function generate(input: Input, options?: StreamOptions) {
  return prepare(input).pipe(
    Effect.flatMap(({ request, output }) =>
      LLMClient.generate(request, options).pipe(
        Effect.flatMap((response) =>
          output === undefined
            ? Effect.succeed(response)
            : decodeObject(output, response).pipe(Effect.map((object) => Object.assign(response, { object }))),
        ),
      ),
    ),
  )
}

/** Stream one model call. With `schema`, the `finish` event carries the decoded `object`. */
export function stream<const Model extends LanguageModel, S extends OutputSchema>(
  input: ObjectInput<S, Model>,
  options?: StreamOptions,
): Stream.Stream<ObjectEvent<OutputType<S>>, AIError, Service>
export function stream<const Model extends LanguageModel>(
  input: RequestInput<Model> | LLMRequest,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError, Service>
export function stream(input: Input, options?: StreamOptions) {
  return Stream.unwrap(
    prepare(input).pipe(
      Effect.map(({ request, output }) =>
        Stream.suspend(() => {
          let state = LLMResponse.empty()
          return LLMClient.stream(request, options).pipe(
            Stream.mapEffect((event) => {
              state = LLMResponse.reduce(state, event)
              return output === undefined || event.type !== "finish"
                ? Effect.succeed(event)
                : withObject(output, event, state)
            }),
          )
        }),
      ),
    ),
  )
}

export type LoopInput<SelectedLanguageModel extends LanguageModel = LanguageModel> = Omit<
  RequestInput<SelectedLanguageModel>,
  "tools"
> & {
  readonly tools: Record<string, ExecutableTool>
  /** Called after each step that has tool calls; returning `true` ends the loop without running them. */
  readonly until?: (state: { readonly steps: ReadonlyArray<LLMResponse> }) => boolean
}

/**
 * Stream model calls, running the model's tool calls between them, until a step has no client-executed tool calls,
 * hits the output token limit, reports a provider error, or `until` returns `true`. Tool calls whose input is not
 * valid JSON get an error result so the model can retry. A forced `toolChoice` applies to the first step only.
 * Each step's `step-start` and `step-finish` carry its step index.
 * With `schema`, the model ends by calling the hidden answer tool, decoded into `object` on that step's `finish`.
 */
export function loop<const Model extends LanguageModel, S extends OutputSchema>(
  input: LoopInput<Model> & { readonly schema: S },
  options?: StreamOptions,
): Stream.Stream<LoopObjectEvent<OutputType<S>>, AIError, Service>
export function loop<const Model extends LanguageModel>(
  input: LoopInput<Model>,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError, Service>
export function loop(input: LoopInput & { readonly schema?: OutputSchema }, options?: StreamOptions) {
  const { tools, until, ...rest } = input
  const step = (
    request: LLMRequest,
    steps: ReadonlyArray<LLMResponse>,
    output: Tool | undefined,
  ): Stream.Stream<LLMEvent, AIError, Service> =>
    Stream.suspend(() => {
      let state = LLMResponse.empty()
      return LLMClient.stream(request, options).pipe(
        Stream.map((event) =>
          event.type === "step-start" || event.type === "step-finish" ? { ...event, index: steps.length } : event,
        ),
        Stream.mapEffect((event) => {
          state = LLMResponse.reduce(state, event)
          if (output === undefined || event.type !== "finish") return Effect.succeed(event)
          const response = LLMResponse.complete(state)
          return response && pendingCalls(response, output).length > 0
            ? Effect.succeed(event)
            : withObject(output, event, state)
        }),
        Stream.mapError((error) => withPartial(error, LLMResponse.partial(state))),
        Stream.concat(
          Stream.unwrap(
            Effect.gen(function* () {
              const response = LLMResponse.complete(state)
              const pending = response ? pendingCalls(response, output) : []
              if (!response || pending.length === 0 || state.events.some(LLMEvent.is.providerError)) return Stream.empty
              const done = [...steps, response]
              if (until?.({ steps: done })) return Stream.empty
              const results = yield* Effect.forEach(
                pending,
                (item) =>
                  item.error === undefined
                    ? ToolRuntime.dispatch(tools, item.call)
                    : Effect.succeed(reject(item.call, item.error)),
                { concurrency: "unbounded" },
              )
              const invalid = pending.flatMap((item) => (item.error === undefined ? [] : [item.call]))
              const next = LLMRequest.update(request, {
                // A caller's forced tool choice applies to the first step only; the answer tool's stays forced.
                toolChoice:
                  output === undefined &&
                  (request.toolChoice?.type === "required" || request.toolChoice?.type === "tool")
                    ? new ToolChoice({
                        type: "auto",
                        disableParallelToolUse: request.toolChoice.disableParallelToolUse,
                      })
                    : request.toolChoice,
                messages: [
                  ...request.messages,
                  invalid.length === 0
                    ? response.message
                    : new Message({ ...response.message, content: [...response.message.content, ...invalid] }),
                  ...pending.map((item, i) =>
                    Message.tool({
                      id: item.call.id,
                      name: item.call.name,
                      namespace: item.call.namespace,
                      result: results[i].result,
                      providerMetadata: item.call.providerMetadata,
                    }),
                  ),
                ],
              })
              return Stream.fromIterable(results.flatMap((result) => result.events)).pipe(
                Stream.concat(step(next, done, output)),
              )
            }),
          ),
        ),
      )
    })
  return Stream.unwrap(
    prepare({ ...rest, tools: toDefinitions(tools) }).pipe(
      Effect.map(({ request, output }) => step(request, [], output)),
    ),
  )
}

const OBJECT_TOOL = "generate_object"

/**
 * Client calls to answer before the next step. A call whose input was not valid JSON carries the error the model
 * gets back, so it can retry. A step is final when it calls the answer tool, even alongside other tools, or when it
 * hits the output token limit, which may have cut its calls off.
 */
const pendingCalls = (
  response: LLMResponse,
  output: Tool | undefined,
): ReadonlyArray<{ readonly call: ToolCallPart; readonly error?: string }> => {
  if (response.finishReason.normalized === "length") return []
  if (output && response.toolCalls.some((call) => call.name === OBJECT_TOOL)) return []
  return [
    ...response.toolCalls.filter((call) => call.providerExecuted !== true).map((call) => ({ call })),
    ...response.events.filter(LLMEvent.is.toolInputError).map((event) => ({
      // Providers require an object input, so the call is replayed with an empty one.
      call: ToolCallPart.make({ id: event.id, name: event.name, namespace: event.namespace, input: {} }),
      error: `Invalid tool arguments: the input is not valid JSON. Received: ${event.raw}`,
    })),
  ]
}

type Input = (RequestInput & { readonly schema?: OutputSchema }) | LLMRequest

// `schema` adds a hidden tool whose input is the answer. With other tools the model only has to call some tool.
const prepare = (input: Input) => {
  if (input instanceof LLMRequest) return Effect.succeed({ request: input, output: undefined })
  const { schema, ...rest } = input
  return tryRequest(() => {
    const base = request(rest)
    if (schema === undefined) return { request: base, output: undefined }
    const description = "Return the structured result by calling this tool."
    const output: Tool = Schema.isSchema(schema)
      ? tool({ description, parameters: schema })
      : tool({ description, jsonSchema: schema })
    const toolChoice = base.tools.length === 0 ? ToolChoice.named(OBJECT_TOOL) : new ToolChoice({ type: "required" })
    return {
      output,
      request: LLMRequest.update(base, {
        tools: [...base.tools, ...toDefinitions({ [OBJECT_TOOL]: output })],
        toolChoice,
      }),
    }
  })
}

const decodeObject = (output: Tool, response: LLMResponse) => {
  const call = response.toolCalls.find((event) => event.name === OBJECT_TOOL)
  const invalid = (message: string, cause?: unknown) =>
    new AIError({ reason: new InvalidProviderOutputError({ message, cause }), partial: response })
  if (call)
    return output
      ._decode(call.input)
      .pipe(Effect.mapError((error) => invalid(`schema decode failed: ${error.message}`, error)))
  return Effect.fail(
    invalid(
      response.finishReason.normalized === "length"
        ? "output hit the token limit before the forced tool call completed"
        : `model did not call the forced \`${OBJECT_TOOL}\` tool`,
    ),
  )
}

const withObject = (output: Tool, event: Finish, state: LLMResponse.State): Effect.Effect<LLMEvent, AIError> => {
  const response = LLMResponse.complete(state)
  return response === undefined
    ? Effect.succeed(event)
    : decodeObject(output, response).pipe(Effect.map((object) => ({ ...event, object })))
}

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

export { canCompact, compact } from "./route/client.js"

export * as LLM from "./llm.js"
