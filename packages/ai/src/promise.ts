import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import type { AwaitOptions, Generation, Snapshot } from "./generation.js"
import { Image, ImageModel, ImageRequest, type ImageOptions, type ImageRequestInput } from "./image.js"
import { ImageClient } from "./image-client.js"
import { LLM } from "./index.js"
import { LLMClient } from "./route/client.js"
import { RequestExecutor } from "./route/executor.js"
import { LanguageModel, LLMRequest } from "./schema/index.js"
import type { RequestInput } from "./llm.js"
import { Speech, SpeechModel, SpeechRequest, type SpeechRequestInput } from "./speech.js"
import { SpeechClient } from "./speech-client.js"
import {
  Transcription,
  TranscriptionModel,
  TranscriptionRequest,
  type TranscriptionOptions,
  type TranscriptionRequestInput,
} from "./transcription.js"
import { TranscriptionClient } from "./transcription-client.js"
import { Video, VideoModel, VideoRequest, type VideoOptions, type VideoRequestInput } from "./video.js"
import { VideoClient } from "./video-client.js"

/**
 * Promise-first entrypoint for scripts and non-Effect callers. One `ManagedRuntime` hosts the LLM, image, video, speech,
 * and transcription clients over a request executor; every method runs the corresponding Effect API and rethrows
 * `AIError` unchanged.
 */
export interface Options {
  /** Executor layer; defaults to `RequestExecutor.fetchLayer`. Inject a recorder or middleware here. */
  readonly layer?: Layer.Layer<RequestExecutor.Service>
}

export interface RunOptions {
  readonly signal?: AbortSignal
}

export type Services =
  | Layer.Success<typeof LLMClient.layer>
  | Layer.Success<typeof ImageClient.layer>
  | Layer.Success<typeof VideoClient.layer>
  | Layer.Success<typeof SpeechClient.layer>
  | Layer.Success<typeof TranscriptionClient.layer>
  | RequestExecutor.Service

/** Promise view of a `Generation`: its snapshot plus `await`, `refresh`, and `cancel` returning promises. */
export type GenerationHandle<Response> = Snapshot & {
  /** Serializable JSON; pass it back to `resume` from another process. */
  readonly token: unknown
  readonly await: (options?: AwaitOptions & RunOptions) => Promise<Response>
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
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      LLMClient.layer,
      ImageClient.layer,
      VideoClient.layer,
      SpeechClient.layer,
      TranscriptionClient.layer,
    ).pipe(Layer.provideMerge(options.layer ?? RequestExecutor.fetchLayer)),
  )

  /** Run any package Effect (for example `asset.bytes()`) inside this runtime. */
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
    refresh: (options) => run(generation.refresh(), options).then(handle),
    cancel: (options) => run(generation.cancel(), options),
  })

  // The typed `generate`/`stream` overloads take a concrete input or a request, not the union; normalize once here.
  const llmRequest = (input: RequestInput | LLMRequest) => (input instanceof LLMRequest ? input : LLM.request(input))
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
    llm: {
      request: LLM.request,
      generate: <const Model extends LanguageModel>(input: RequestInput<Model> | LLMRequest, options?: RunOptions) =>
        run(LLM.generate(llmRequest(input)), options),
      stream: <const Model extends LanguageModel>(input: RequestInput<Model> | LLMRequest, options?: RunOptions) =>
        iterate(LLM.stream(llmRequest(input)), options),
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

/** Default client over `RequestExecutor.fetchLayer` for scripts; the runtime builds its layer on first use. */
export const ai = make()

export * as AI from "./promise.js"
