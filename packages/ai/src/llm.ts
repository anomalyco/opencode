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
  type FinishReasonDetails,
  ToolChoice,
  ToolEntry,
  Usage,
  type ContentPart,
  type LanguageModelProviderOptions,
  type ToolEntryInput,
  withPartial,
} from "./schema/index.js"
import { tool, toDefinitions, type ExecutableTool, type Tool, type ToolSchema } from "./tool.js"
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

/** Loop events for a request with `schema`: the loop's `finish` event carries the decoded `object`. */
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

/**
 * Stream one model call. The `finish` event carries the assistant `message` and `usage`; with `schema`, also the
 * decoded `object`.
 */
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
              const response = event.type === "finish" ? LLMResponse.complete(state) : undefined
              if (!response || event.type !== "finish") return Effect.succeed(event)
              const finish = { ...event, usage: response.usage, message: response.message }
              return output === undefined ? Effect.succeed(finish) : withObject(output, finish, state)
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
 * Stream model calls, running the model's tool calls between them, until a step has no client-executed tool calls or
 * `until` returns `true`. Each step's `step-start` and `step-finish` carry its step index and usage; one `finish` ends
 * the loop with the final step's reason and `message` and the usage summed across steps. With `schema`, the model ends
 * by calling the hidden answer tool, decoded into `object` on the `finish`.
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
  // A step that calls the answer tool is final, even if it also called other tools.
  const clientCalls = (response: LLMResponse, output: Tool | undefined) =>
    output && response.toolCalls.some((call) => call.name === OBJECT_TOOL)
      ? []
      : response.toolCalls.filter((call) => call.providerExecuted !== true)
  const step = (
    request: LLMRequest,
    steps: ReadonlyArray<LLMResponse>,
    usage: Usage | undefined,
    output: Tool | undefined,
  ): Stream.Stream<LLMEvent, AIError, Service> =>
    Stream.suspend(() => {
      let state = LLMResponse.empty()
      return LLMClient.stream(request, options).pipe(
        Stream.map((event) =>
          event.type === "step-start" || event.type === "step-finish" ? { ...event, index: steps.length } : event,
        ),
        Stream.tap((event) => Effect.sync(() => (state = LLMResponse.reduce(state, event)))),
        // Each call's `finish` ends only this step; the loop emits its own once it stops.
        Stream.filter((event) => event.type !== "finish"),
        Stream.mapError((error) => withPartial(error, LLMResponse.partial(state))),
        Stream.concat(
          Stream.unwrap(
            Effect.gen(function* () {
              const response = LLMResponse.complete(state)
              const finish = state.events.findLast(LLMEvent.is.finish)
              if (!response || !finish) return Stream.empty
              const total = addUsage(usage, response.usage)
              const calls = clientCalls(response, output)
              const done = [...steps, response]
              if (calls.length === 0 || until?.({ steps: done })) {
                const event = { ...finish, usage: total, message: response.message }
                return Stream.fromEffect(
                  output === undefined || calls.length > 0 ? Effect.succeed(event) : withObject(output, event, state),
                )
              }
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
                Stream.concat(step(next, done, total, output)),
              )
            }),
          ),
        ),
      )
    })
  return Stream.unwrap(
    prepare({ ...rest, tools: toDefinitions(tools) }).pipe(
      Effect.map(({ request, output }) => step(request, [], undefined, output)),
    ),
  )
}

/** The result of `collect`: every step of a stream from `stream` or `loop`, folded into one value. */
export interface Collected {
  /** Text of the final step. */
  readonly text: string
  /** One response per model call, in order. */
  readonly steps: ReadonlyArray<LLMResponse>
  /** Each step's assistant message followed by its tool results, ready to append to the request's messages. */
  readonly messages: ReadonlyArray<Message>
  /** Usage from the terminal `finish`, summed across steps for a loop. */
  readonly usage?: Usage
  readonly finishReason: FinishReasonDetails
}

type FinishOf<Event> = Extract<Event, { readonly type: "finish" }>

/** `Collected`, plus `object` when the stream was started with `schema`. */
export type CollectResult<Event> = "object" extends keyof FinishOf<Event>
  ? Collected & Pick<FinishOf<Event>, "object">
  : Collected

/** Run a stream from `stream` or `loop` to the end and fold its events into the final result. */
export function collect<Event extends LLMEvent, E, R>(
  events: Stream.Stream<Event, E, R>,
): Effect.Effect<CollectResult<Event>, E | AIError, R>
export function collect<E, R>(
  events: Stream.Stream<LLMEvent, E, R>,
): Effect.Effect<Collected & { readonly object?: unknown }, E | AIError, R> {
  return Effect.suspend(() => {
    const steps: LLMResponse[] = []
    const messages: Message[] = []
    let step = LLMResponse.empty()
    // Between a `step-finish` and the next `step-start`, tool results come from the loop running tools.
    let betweenSteps = false
    let finish: Finish | undefined
    const close = (reason: FinishReasonDetails, usage: Usage | undefined) => {
      if (step.events.length === 0) return
      const response = new LLMResponse({
        message: step.message,
        events: step.events,
        usage: usage ?? step.usage,
        finishReason: reason,
      })
      steps.push(response)
      messages.push(response.message)
      step = LLMResponse.empty()
    }
    return Stream.runForEach(events, (event) =>
      Effect.sync(() => {
        if (event.type === "finish") {
          close(event.reason, event.usage)
          finish = event
          return
        }
        if (event.type === "tool-result" && betweenSteps) {
          messages.push(
            Message.tool({
              id: event.id,
              name: event.name,
              namespace: event.namespace,
              result: event.result,
              providerMetadata: event.providerMetadata,
            }),
          )
          return
        }
        if (event.type === "step-start") betweenSteps = false
        step = LLMResponse.reduce(step, event)
        if (event.type !== "step-finish") return
        close(event.reason, event.usage)
        betweenSteps = true
      }),
    ).pipe(
      Effect.flatMap(() => {
        if (finish === undefined)
          return Effect.fail(
            new AIError({
              reason: new InvalidProviderOutputError({
                message: "The stream ended without a finish event.",
                classification: "incomplete-stream",
              }),
            }),
          )
        const result = {
          text: steps.at(-1)?.text ?? "",
          steps,
          messages,
          usage: finish.usage,
          finishReason: finish.reason,
          ...("object" in finish ? { object: finish.object } : {}),
        }
        return Effect.succeed(result)
      }),
    )
  })
}

const addUsage = (total: Usage | undefined, step: Usage | undefined) => {
  if (total === undefined || step === undefined) return total ?? step
  const sum = (
    key:
      | "inputTokens"
      | "outputTokens"
      | "nonCachedInputTokens"
      | "cacheReadInputTokens"
      | "cacheWriteInputTokens"
      | "reasoningTokens"
      | "totalTokens"
      | "cost",
  ) => (total[key] === undefined && step[key] === undefined ? undefined : (total[key] ?? 0) + (step[key] ?? 0))
  return new Usage({
    // Context size describes the latest call, not a running total.
    contextTokens: step.contextTokens ?? total.contextTokens,
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    nonCachedInputTokens: sum("nonCachedInputTokens"),
    cacheReadInputTokens: sum("cacheReadInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    cost: sum("cost"),
  })
}

const OBJECT_TOOL = "generate_object"

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
