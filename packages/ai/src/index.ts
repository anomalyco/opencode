import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import { AIClient } from "./ai-client.js"
import { Decision, type DecisionModel, type DecisionQuestions, type DecisionRequestInput } from "./decision.js"
import type { AwaitOptions, Event, Generation, Snapshot } from "./generation.js"
import { Image, type ImageModel, type ImageRequest, type ImageRequestInput } from "./image.js"
import { LLM } from "./effect.js"
import { Media } from "./media.js"
import { RequestExecutor } from "./route/executor.js"
import { AIError, InvalidRequestError, LanguageModel, type LLMRequest } from "./schema/index.js"
import type {
  GenerateObjectDynamicOptions,
  GenerateObjectOptions,
  GenerateObjectResponse,
  LoopInput,
  RequestInput,
} from "./llm.js"
import { Speech, type SpeechModel, type SpeechRequest, type SpeechRequestInput } from "./speech.js"
import {
  Transcription,
  type TranscriptionModel,
  type TranscriptionRequest,
  type TranscriptionRequestInput,
} from "./transcription.js"
import { Tool, ToolFailure, type ToolExecuteContext, type ToolSchema } from "./tool.js"
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

  /** Run any package Effect (for example `LLMClient.compact(...)`) inside this runtime. */
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

  function generateObject<const Model extends LanguageModel, S extends ToolSchema<any>>(
    input: GenerateObjectOptions<S, Model>,
    options?: RunOptions,
  ): Promise<GenerateObjectResponse<Schema.Schema.Type<S>>>
  function generateObject<const Model extends LanguageModel>(
    input: GenerateObjectDynamicOptions<Model>,
    options?: RunOptions,
  ): Promise<GenerateObjectResponse<unknown>>
  function generateObject(
    input: GenerateObjectOptions<ToolSchema<any>> | GenerateObjectDynamicOptions,
    options?: RunOptions,
  ) {
    return run("schema" in input ? LLM.generateObject(input) : LLM.generateObject(input), options)
  }

  const handle = <Response>(generation: Generation<Response>): GenerationHandle<Response> => ({
    ...generation.snapshot,
    token: generation.token,
    await: (options) => run(generation.await({ poll: options?.poll }), options),
    events: (options) => iterate(generation.events({ poll: options?.poll }), options),
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
    llm: {
      request: LLM.request,
      generate: <const Model extends LanguageModel>(input: RequestInput<Model> | LLMRequest, options?: RunOptions) =>
        run(LLM.generate(input), options),
      stream: <const Model extends LanguageModel>(input: RequestInput<Model> | LLMRequest, options?: RunOptions) =>
        iterate(LLM.stream(input), options),
      /** Stream model calls, running their tool calls, until the model stops calling tools or `until` is true. */
      loop: <const Model extends LanguageModel>(input: LoopInput<Model>, options?: RunOptions) =>
        iterate(LLM.loop(input), options),
      /** Decode the model's output against `schema` (or `jsonSchema`, unvalidated) like `LLM.generateObject`. */
      generateObject,
    },
    image: {
      request: Image.request,
      generate: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: AwaitOptions & RunOptions,
      ) => run(Image.generate(input, { poll: options?.poll }), options),
      stream: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: AwaitOptions & RunOptions,
      ) => iterate(Image.stream(input, { poll: options?.poll }), options),
      start: <const Model extends ImageModel>(input: ImageRequestInput<Model> | ImageRequest, options?: RunOptions) =>
        run(Image.start(input), options).then(handle),
      resume: (model: ImageModel, token: unknown, options?: RunOptions) =>
        run(Image.resume(model, token), options).then(handle),
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
    decision: {
      request: Decision.request,
      generate: <const Model extends DecisionModel, const Questions extends DecisionQuestions>(
        input: DecisionRequestInput<Model, Questions>,
        options?: RunOptions,
      ) => run(Decision.generate(input), options),
    },
    dispose: () => runtime.dispose(),
  }
}

export type Client = ReturnType<typeof make>

const fileError = (message: string, cause: unknown) =>
  new AIError({ reason: new InvalidRequestError({ message, cause }) })

/**
 * Promise counterpart of `Tool.make` for `ai.llm.loop`. A throw or rejection becomes the error result the model sees, the
 * returned value is sent unvalidated (`undefined` as `null`), and `signal` aborts when the loop is interrupted.
 */
export const tool = <Parameters extends ToolSchema<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly execute: (
    params: Schema.Schema.Type<Parameters>,
    context: Partial<ToolExecuteContext> & { readonly signal: AbortSignal },
  ) => unknown
}) =>
  Tool.make({
    description: config.description,
    parameters: config.parameters,
    success: Schema.Unknown,
    execute: (params, context) =>
      Effect.tryPromise({
        try: async (signal) => (await config.execute(params, { ...context, signal })) ?? null,
        catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
      }),
  })

/** Default client over `RequestExecutor.fetchLayer` for scripts; the runtime builds its layer on first use. */
export const ai = make()

export * as AI from "./index.js"
