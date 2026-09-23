import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import { AIClient } from "./ai-client.js"
import type { AwaitOptions, Event, Generation, Snapshot } from "./generation.js"
import { Image, ImageModel, ImageRequest, type ImageOptions, type ImageRequestInput } from "./image.js"
import { LLM } from "./index.js"
import { Media } from "./media.js"
import { RequestExecutor } from "./route/executor.js"
import { AIError, InvalidRequestError, LanguageModel, LLMRequest } from "./schema/index.js"
import type { RequestInput } from "./llm.js"
import { Speech, SpeechModel, SpeechRequest, type SpeechRequestInput } from "./speech.js"
import {
  Transcription,
  TranscriptionModel,
  TranscriptionRequest,
  type TranscriptionOptions,
  type TranscriptionRequestInput,
} from "./transcription.js"
import { fileMediaType } from "./utils/media-type.js"
import { Video, VideoModel, VideoRequest, type VideoOptions, type VideoRequestInput } from "./video.js"

/**
 * Promise-first entrypoint for scripts and non-Effect callers. One `ManagedRuntime` hosts the LLM, image, video, speech,
 * and transcription clients over a request executor; every method runs the corresponding Effect API and rethrows
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
  /** Status observations until the first terminal one, polling like `await`; abort ends iteration without throwing. */
  readonly events: (options?: AwaitOptions & RunOptions) => AsyncIterable<Event>
  /** The result without polling; fails when the generation has not completed. */
  readonly result: (options?: RunOptions) => Promise<Response>
  readonly refresh: (options?: RunOptions) => Promise<GenerationHandle<Response>>
  readonly cancel: (options?: RunOptions) => Promise<void>
}

const abortEffect = (signal: AbortSignal | undefined) =>
  signal === undefined
    ? Effect.never
    : Effect.callback<void>((resume) => {
        if (signal.aborted) {
          resume(Effect.void)
          return
        }
        const onAbort = () => resume(Effect.void)
        signal.addEventListener("abort", onAbort, { once: true })
        return Effect.sync(() => signal.removeEventListener("abort", onAbort))
      })

export const make = (options: Options = {}) => {
  const runtime = ManagedRuntime.make(AIClient.layerWith(options.layer ?? RequestExecutor.fetchLayer))

  /** Run any package Effect (for example `LLMClient.compact(...)`) inside this runtime. */
  const run = <A, E>(effect: Effect.Effect<A, E, Services>, options?: RunOptions) =>
    runtime.runPromise(effect, { signal: options?.signal })

  const iterate = <A, E>(stream: Stream.Stream<A, E, Services>, options?: RunOptions): AsyncIterable<A> =>
    Stream.toAsyncIterable(
      Stream.unwrap(
        runtime.contextEffect.pipe(
          Effect.map(
            (context): Stream.Stream<A, E> =>
              stream.pipe(Stream.interruptWhen(abortEffect(options?.signal)), Stream.provideContext(context)),
          ),
        ),
      ),
    )

  const handle = <Response>(generation: Generation<Response>): GenerationHandle<Response> => ({
    ...generation.snapshot,
    token: generation.token,
    await: (options) => run(generation.await({ poll: options?.poll }), options),
    events: (options) => iterate(generation.events({ poll: options?.poll }), options),
    result: (options) => run(generation.result(), options),
    refresh: (options) => run(generation.refresh(), options).then(handle),
    cancel: (options) => run(generation.cancel(), options),
  })

  // The typed `generate`/`stream` overloads take a concrete input or a request, not the union; normalize once here.
  const imageRequest = (input: ImageRequestInput | ImageRequest) =>
    input instanceof ImageRequest ? input : Image.request(input)
  const videoRequest = (input: VideoRequestInput | VideoRequest) =>
    input instanceof VideoRequest ? input : Video.request(input)
  const speechRequest = (input: SpeechRequestInput | SpeechRequest) =>
    input instanceof SpeechRequest ? input : Speech.request(input)
  const transcriptionRequest = (input: TranscriptionRequestInput | TranscriptionRequest) =>
    input instanceof TranscriptionRequest ? input : Transcription.request(input)

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
    },
    image: {
      request: Image.request,
      generate: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: AwaitOptions & RunOptions,
      ) => run(Image.generate(imageRequest(input), { poll: options?.poll }), options),
      stream: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: AwaitOptions & RunOptions,
      ) => iterate(Image.stream(imageRequest(input), { poll: options?.poll }), options),
      start: <const Model extends ImageModel>(input: ImageRequestInput<Model> | ImageRequest, options?: RunOptions) =>
        run(Image.start(imageRequest(input)), options).then(handle),
      resume: <Options extends ImageOptions>(model: ImageModel<Options>, token: unknown, options?: RunOptions) =>
        run(Image.resume(model, token), options).then(handle),
    },
    video: {
      request: Video.request,
      start: <const Model extends VideoModel>(input: VideoRequestInput<Model> | VideoRequest, options?: RunOptions) =>
        run(Video.start(videoRequest(input)), options).then(handle),
      generate: <const Model extends VideoModel>(
        input: VideoRequestInput<Model> | VideoRequest,
        options?: AwaitOptions & RunOptions,
      ) => run(Video.generate(videoRequest(input), { poll: options?.poll }), options),
      resume: <Options extends VideoOptions>(model: VideoModel<Options>, token: unknown, options?: RunOptions) =>
        run(Video.resume(model, token), options).then(handle),
      stream: <const Model extends VideoModel>(
        input: VideoRequestInput<Model> | VideoRequest,
        options?: AwaitOptions & RunOptions,
      ) => iterate(Video.stream(videoRequest(input), { poll: options?.poll }), options),
    },
    speech: {
      request: Speech.request,
      generate: <const Model extends SpeechModel>(
        input: SpeechRequestInput<Model> | SpeechRequest,
        options?: RunOptions,
      ) => run(Speech.generate(speechRequest(input)), options),
      stream: <const Model extends SpeechModel>(
        input: SpeechRequestInput<Model> | SpeechRequest,
        options?: RunOptions,
      ) => iterate(Speech.stream(speechRequest(input)), options),
    },
    transcription: {
      request: Transcription.request,
      generate: <const Model extends TranscriptionModel>(
        input: TranscriptionRequestInput<Model> | TranscriptionRequest,
        options?: AwaitOptions & RunOptions,
      ) => run(Transcription.generate(transcriptionRequest(input), { poll: options?.poll }), options),
      stream: <const Model extends TranscriptionModel>(
        input: TranscriptionRequestInput<Model> | TranscriptionRequest,
        options?: AwaitOptions & RunOptions,
      ) => iterate(Transcription.stream(transcriptionRequest(input), { poll: options?.poll }), options),
      start: <const Model extends TranscriptionModel>(
        input: TranscriptionRequestInput<Model> | TranscriptionRequest,
        options?: RunOptions,
      ) => run(Transcription.start(transcriptionRequest(input)), options).then(handle),
      resume: <Options extends TranscriptionOptions>(
        model: TranscriptionModel<Options>,
        token: unknown,
        options?: RunOptions,
      ) => run(Transcription.resume(model, token), options).then(handle),
    },
    dispose: () => runtime.dispose(),
  }
}

export type Client = ReturnType<typeof make>

const fileError = (message: string, cause: unknown) =>
  new AIError({ reason: new InvalidRequestError({ message, cause }) })

/** Default client over `RequestExecutor.fetchLayer` for scripts; the runtime builds its layer on first use. */
export const ai = make()

export * as AI from "./promise.js"
