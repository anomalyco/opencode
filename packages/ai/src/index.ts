import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import { AIClient } from "./ai-client.js"
import { Decision, type DecisionModel, type DecisionQuestions, type DecisionRequestInput } from "./decision.js"
import type { AwaitOptions, Event, Generation, Snapshot } from "./generation.js"
import { Image, type ImageModel, type ImageRequest, type ImageRequestInput } from "./image.js"
import { LLM } from "./llm.js"
import { Media } from "./media.js"
import {
  type CheckpointRequest,
  type CompactionRequest,
  type EndpointCompactOptions,
  type StreamOptions,
  type TriggerCompactOptions,
} from "./route/client.js"
import { RequestExecutor } from "./route/executor.js"
import {
  AIError,
  InvalidRequestError,
  LanguageModel,
  type CompactionCheckpointResponse,
  type CompactionResponse,
  type LLMEvent,
  type LLMRequest,
  type LLMResponse,
} from "./schema/index.js"
import type {
  LoopInput,
  LoopObjectEvent,
  ObjectEvent,
  ObjectInput,
  ObjectResponse,
  OutputSchema,
  OutputType,
  RequestInput,
} from "./llm.js"
import { Speech, type SpeechModel, type SpeechRequest, type SpeechRequestInput } from "./speech.js"
import {
  Transcription,
  type TranscriptionModel,
  type TranscriptionRequest,
  type TranscriptionRequestInput,
} from "./transcription.js"
import { ToolFailure, build } from "./tool.js"
import type { NoExecute, ToolExecuteContext, ToolOptions, ToolSchema } from "./tool.js"
import { fileMediaType } from "./utils/media-type.js"
import { Video, type VideoModel, type VideoRequest, type VideoRequestInput } from "./video.js"

/**
 * Promise-first entrypoint for scripts and non-Effect callers. One `ManagedRuntime` hosts the LLM, image, video, speech,
 * transcription and decision clients over a request executor; every method runs the corresponding Effect API and rethrows
 * `AIError` unchanged. `file` and `write` load `node:fs/promises` on first use, so importing this module does not.
 */
export interface Options {
  /** Executor layer; defaults to `RequestExecutor.fetchLayer`. Inject a recorder or `RequestExecutor.middleware(fn)` here. */
  readonly layer?: Layer.Layer<RequestExecutor.Service>
}

export interface RunOptions {
  readonly signal?: AbortSignal
}

export type Services = AIClient.Services

/**
 * Promise view of a `Generation`. Its fields are a snapshot taken when the handle was created; `refresh()` resolves to a
 * new handle rather than updating this one.
 */
export type GenerationHandle<Response> = Snapshot & {
  readonly snapshot: Snapshot
  readonly terminal: boolean
  /** Serializable JSON; pass it back to `resume` from another process. */
  readonly token: unknown
  readonly await: (options?: AwaitOptions & RunOptions) => Promise<Response>
  /** Status observations until the first terminal one, polling like `await`; abort throws `signal.reason`. */
  readonly events: (options?: AwaitOptions & RunOptions) => AsyncIterable<Event>
  /** The result without polling; fails when the generation has not completed. */
  readonly result: (options?: RunOptions) => Promise<Response>
  readonly refresh: (options?: RunOptions) => Promise<GenerationHandle<Response>>
  readonly cancel: (options?: RunOptions) => Promise<void>
}

// Fails with `signal.reason` so aborted calls reject and aborted streams throw like `fetch`: an `AbortError` by default.
const abortEffect = (signal: AbortSignal | undefined) =>
  signal === undefined
    ? Effect.never
    : Effect.callback<never, unknown>((resume) => {
        if (signal.aborted) {
          resume(Effect.fail(signal.reason))
          return
        }
        const onAbort = () => resume(Effect.fail(signal.reason))
        signal.addEventListener("abort", onAbort, { once: true })
        return Effect.sync(() => signal.removeEventListener("abort", onAbort))
      })

export const make = (options: Options = {}) => {
  const runtime = ManagedRuntime.make(AIClient.layerWith(options.layer ?? RequestExecutor.fetchLayer))

  /** Run any package Effect (for example `ai.compact(...)` from `@opencode/ai/effect`) inside this runtime. */
  const run = <A, E>(effect: Effect.Effect<A, E, Services>, options?: RunOptions) =>
    runtime.runPromise(Effect.raceFirst(effect, abortEffect(options?.signal)))

  const iterate = <A, E>(stream: Stream.Stream<A, E, Services>, options?: RunOptions): AsyncIterable<A> =>
    Stream.toAsyncIterable(
      Stream.unwrap(
        runtime.contextEffect.pipe(
          Effect.map(
            (context): Stream.Stream<A, unknown> =>
              stream.pipe(Stream.interruptWhen(abortEffect(options?.signal)), Stream.provideContext(context)),
          ),
        ),
      ),
    )

  function generate<const Model extends LanguageModel, S extends OutputSchema>(
    input: ObjectInput<S, Model>,
    options?: StreamOptions & RunOptions,
  ): Promise<ObjectResponse<OutputType<S>>>
  function generate<const Model extends LanguageModel>(
    input: RequestInput<Model> | LLMRequest,
    options?: StreamOptions & RunOptions,
  ): Promise<LLMResponse>
  function generate(
    input: ObjectInput<OutputSchema> | RequestInput | LLMRequest,
    options?: StreamOptions & RunOptions,
  ) {
    return run(LLM.generate(input, options), options)
  }

  function stream<const Model extends LanguageModel, S extends OutputSchema>(
    input: ObjectInput<S, Model>,
    options?: StreamOptions & RunOptions,
  ): AsyncIterable<ObjectEvent<OutputType<S>>>
  function stream<const Model extends LanguageModel>(
    input: RequestInput<Model> | LLMRequest,
    options?: StreamOptions & RunOptions,
  ): AsyncIterable<LLMEvent>
  function stream(input: ObjectInput<OutputSchema> | RequestInput | LLMRequest, options?: StreamOptions & RunOptions) {
    return iterate(LLM.stream(input, options), options)
  }

  function loop<const Model extends LanguageModel, S extends OutputSchema>(
    input: LoopInput<Model> & { readonly schema: S },
    options?: StreamOptions & RunOptions,
  ): AsyncIterable<LoopObjectEvent<OutputType<S>>>
  function loop<const Model extends LanguageModel>(
    input: LoopInput<Model>,
    options?: StreamOptions & RunOptions,
  ): AsyncIterable<LLMEvent>
  function loop(input: LoopInput & { readonly schema?: OutputSchema }, options?: StreamOptions & RunOptions) {
    return iterate(LLM.loop(input, options), options)
  }

  function compact(
    request: CheckpointRequest,
    options: TriggerCompactOptions & RunOptions,
  ): Promise<CompactionCheckpointResponse>
  function compact(
    request: CompactionRequest,
    options?: EndpointCompactOptions & RunOptions,
  ): Promise<CompactionResponse>
  // The overloads pair each request type with its mechanism; `LLM.compact` checks the route's capability at runtime.
  function compact(
    request: CheckpointRequest | CompactionRequest,
    options?: (TriggerCompactOptions | EndpointCompactOptions) & RunOptions,
  ) {
    return options?.mechanism === "trigger"
      ? run(LLM.compact(request as CheckpointRequest, options), options)
      : run(LLM.compact(request as CompactionRequest, options), options)
  }

  const handle = <Response>(generation: Generation<Response>): GenerationHandle<Response> => ({
    ...generation.snapshot,
    snapshot: generation.snapshot,
    terminal: generation.terminal,
    token: generation.token,
    await: (options) => run(generation.await(options), options),
    events: (options) => iterate(generation.events(options), options),
    result: (options) => run(generation.result(), options),
    refresh: (options) => run(generation.refresh(), options).then(handle),
    cancel: (options) => run(generation.cancel(), options),
  })

  return {
    run,
    /** Decoded asset bytes, downloading `url` sources through the executor. */
    bytes: (asset: Media.Asset, options?: RunOptions) => run(asset.bytes(), options),
    base64: (asset: Media.Asset, options?: RunOptions) => run(asset.base64(), options),
    /** Pull a `url` asset into owned bytes before the provider URL expires. */
    materialize: (asset: Media.Asset, options?: RunOptions) => run(asset.materialize(), options),
    /** Read a file into an asset like `Media.file`: sniffed media type, then the extension's. */
    file: async (path: string, options?: Media.AssetOptions & RunOptions) => {
      const { readFile } = await import("node:fs/promises")
      return run(
        Effect.tryPromise({
          try: (signal) => readFile(path, { signal }),
          catch: (cause) => fileError(`Failed to read media file ${path}`, cause),
        }).pipe(
          Effect.map((buffer) => {
            const data = new Uint8Array(buffer)
            return Media.bytes(data, fileMediaType(data, path), options)
          }),
        ),
        options,
      )
    },
    /** Write an asset's bytes like `Media.write`, downloading `url` sources through the executor. */
    write: async (asset: Media.Asset, path: string, options?: RunOptions) => {
      const { writeFile } = await import("node:fs/promises")
      return run(
        asset.bytes().pipe(
          Effect.flatMap((data) =>
            Effect.tryPromise({
              try: (signal) => writeFile(path, data, { signal }),
              catch: (cause) => fileError(`Failed to write media file ${path}`, cause),
            }),
          ),
        ),
        options,
      )
    },
    request: LLM.request,
    generate,
    stream,
    /** Stream model calls, running their tool calls, until the model stops calling tools or `until` is true. */
    loop,
    /** Compact a Responses request: a replacement window, or a checkpoint with `mechanism: "trigger"`. */
    compact,
    canCompact: LLM.canCompact,
    image: {
      request: Image.request,
      generate: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: AwaitOptions & RunOptions,
      ) => run(Image.generate(input, options), options),
      stream: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: AwaitOptions & RunOptions,
      ) => iterate(Image.stream(input, options), options),
      start: <const Model extends ImageModel>(input: ImageRequestInput<Model> | ImageRequest, options?: RunOptions) =>
        run(Image.start(input), options).then(handle),
      resume: (model: ImageModel, token: unknown, options?: RunOptions) =>
        run(Image.resume(model, token), options).then(handle),
    },
    decision: {
      request: Decision.request,
      generate: <const Model extends DecisionModel, const Questions extends DecisionQuestions>(
        input: DecisionRequestInput<Model, Questions>,
        options?: RunOptions,
      ) => run(Decision.generate(input), options),
    },
    /** Experimental: may change without compatibility guarantees. */
    experimental: {
      speech: {
        request: Speech.request,
        generate: <const Model extends SpeechModel>(
          input: SpeechRequestInput<Model> | SpeechRequest,
          options?: RunOptions,
        ) => run(Speech.generate(input), options),
        stream: <const Model extends SpeechModel>(
          input: SpeechRequestInput<Model> | SpeechRequest,
          options?: RunOptions,
        ) => iterate(Speech.stream(input), options),
      },
      transcription: {
        request: Transcription.request,
        generate: <const Model extends TranscriptionModel>(
          input: TranscriptionRequestInput<Model> | TranscriptionRequest,
          options?: AwaitOptions & RunOptions,
        ) => run(Transcription.generate(input, { poll: options?.poll }), options),
        stream: <const Model extends TranscriptionModel>(
          input: TranscriptionRequestInput<Model> | TranscriptionRequest,
          options?: AwaitOptions & RunOptions,
        ) => iterate(Transcription.stream(input, { poll: options?.poll }), options),
        start: <const Model extends TranscriptionModel>(
          input: TranscriptionRequestInput<Model> | TranscriptionRequest,
          options?: RunOptions,
        ) => run(Transcription.start(input), options).then(handle),
        resume: (model: TranscriptionModel, token: unknown, options?: RunOptions) =>
          run(Transcription.resume(model, token), options).then(handle),
      },
      video: {
        request: Video.request,
        start: <const Model extends VideoModel>(input: VideoRequestInput<Model> | VideoRequest, options?: RunOptions) =>
          run(Video.start(input), options).then(handle),
        generate: <const Model extends VideoModel>(
          input: VideoRequestInput<Model> | VideoRequest,
          options?: AwaitOptions & RunOptions,
        ) => run(Video.generate(input, { poll: options?.poll }), options),
        resume: (model: VideoModel, token: unknown, options?: RunOptions) =>
          run(Video.resume(model, token), options).then(handle),
        stream: <const Model extends VideoModel>(
          input: VideoRequestInput<Model> | VideoRequest,
          options?: AwaitOptions & RunOptions,
        ) => iterate(Video.stream(input, { poll: options?.poll }), options),
      },
    },
    dispose: () => runtime.dispose(),
  }
}

export type Client = ReturnType<typeof make>

const fileError = (message: string, cause: unknown) =>
  new AIError({ reason: new InvalidRequestError({ message, cause }) })

/** `tool` from `@opencode/ai/effect`, with an `execute` that returns a value or a Promise and throws to fail. */
export const tool = <
  Parameters extends ToolSchema<any> = typeof Schema.Unknown,
  Success extends ToolSchema<any> = typeof Schema.Unknown,
  Result extends Schema.Schema.Type<Success> | PromiseLike<Schema.Schema.Type<Success>> | NoExecute = NoExecute,
>(
  config: ToolOptions<
    Parameters,
    Success,
    (params: Schema.Schema.Type<Parameters>, context: Partial<ToolExecuteContext> & { signal: AbortSignal }) => Result
  >,
) => {
  const execute = config.execute
  return build(
    config,
    execute &&
      ((params, context) =>
        Effect.tryPromise({
          try: async (signal) => execute(params, { ...context, signal }),
          catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
        })),
  )
}

/** Default client over `RequestExecutor.fetchLayer`; the runtime builds its layer on first use and holds nothing to dispose. */
export const ai: Omit<Client, "dispose"> = make()

export * as AI from "./index.js"
export { isContextOverflow, isContextOverflowFailure, isRetryable } from "./provider-error.js"
export {
  ProtocolID,
  RouteID,
  ModelID,
  ProviderID,
  ResponseID,
  ContentBlockID,
  ToolCallID,
  JsonSchema,
  ProviderOptions,
  ProviderMetadata,
  HttpTimeout,
  RequestEncoding,
  HttpOptions,
  GenerationOptions,
  LanguageModelDefaults,
  ReasoningEfforts,
  ReasoningEffort,
  LanguageModelCompatibility,
  LanguageModel,
  LanguageModelSchema,
  CacheTTL,
  CacheHint,
  CachePolicyObject,
  CachePolicy,
  MessageRole,
  SystemPart,
  TextPart,
  MediaPart,
  ToolResultValue,
  ToolOutput,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
  CompactionPart,
  EffortPart,
  ContentPart,
  Message,
  Freeform,
  ToolDefinition,
  ToolNamespace,
  ToolEntry,
  ToolChoice,
  LLMRequest,
  FinishReason,
  Usage,
  MediaUsage,
  CompactionResponse,
  CompactionCheckpointResponse,
  StepStart,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolInputError,
  ToolCall,
  ToolResult,
  ToolError,
  FinishReasonDetails,
  StepFinish,
  Finish,
  MediaEvent,
  ProviderErrorEvent,
  LLMEvent,
  LLMResponse,
  HttpContext,
  HttpRateLimitDetails,
  InvalidRequestError,
  UnsupportedOperationError,
  ProviderConfigurationError,
  AuthenticationError,
  RateLimitError,
  QuotaExceededError,
  ContentPolicyError,
  ProviderInternalError,
  TransportType,
  TransportOperation,
  TransportError,
  InvalidProviderOutputError,
  UnknownProviderError,
  TimeoutError,
  AIErrorReason,
  AIError,
} from "./schema/index.js"
export type {
  GenerationOptionsFields,
  GenerationOptionsInput,
  LanguageModelInput,
  LanguageModelProviderOptions,
  ToolDefinitionInput,
  ToolNamespaceInput,
  ToolNamespaceEntryInput,
  ToolEntryInput,
  UsageInput,
} from "./schema/index.js"
export { ImageAspectRatio, ImageEvent, ImageModel, ImageModelSchema, ImageRequest, ImageResponse } from "./image.js"
export type {
  ImageModelOptions,
  ImageOptions,
  ImageRequestFor,
  ImageRequestInput,
  ImageResolution,
  ImageRoute,
} from "./image.js"
export {
  ChoiceAnswer,
  ChoiceQuestion,
  ChoiceValue,
  DecisionAnswer,
  DecisionJsonPart,
  DecisionMediaPart,
  DecisionModel,
  DecisionModelCompatibility,
  DecisionModelSchema,
  DecisionPart,
  DecisionQuestion,
  DecisionRequest,
  DecisionResponse,
  DecisionTextPart,
  DecisionUsage,
  ErrorAnswer,
  ErrorReason,
  PredicateAnswer,
  PredicateQuestion,
  ScoreAnswer,
  ScoreQuestion,
} from "./decision.js"
export type {
  AnswerFor,
  AnswersFor,
  DecisionInput,
  DecisionModelOptions,
  DecisionOptions,
  DecisionQuestions,
  DecisionRequestFor,
  DecisionRequestInput,
  DecisionResponseFor,
  DecisionModelRoute,
} from "./decision.js"
export { Media } from "./media.js"
export type {
  AwaitOptions as GenerationAwaitOptions,
  Event as GenerationEvent,
  Poll,
  Route as GenerationRoute,
  Snapshot as GenerationSnapshot,
  Status as GenerationStatus,
} from "./generation.js"
export type {
  ExecutableTool,
  Tool,
  ToolExecute,
  ToolExecuteContext,
  ToolModelOutputInput,
  ToolOptions,
  ToolSchema,
  ToolToModelOutput,
} from "./tool.js"
export type { LLM } from "./llm.js"
