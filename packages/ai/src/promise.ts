import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import { Image, ImageModel, ImageRequest, type ImageRequestInput } from "./image.js"
import { ImageClient } from "./image-client.js"
import { LLM } from "./index.js"
import { LLMClient } from "./route/client.js"
import { RequestExecutor } from "./route/executor.js"
import { LanguageModel, LLMRequest } from "./schema/index.js"
import type { RequestInput } from "./llm.js"

/**
 * Promise-first entrypoint for scripts and non-Effect callers. One `ManagedRuntime` hosts the LLM and image clients
 * over a request executor; every method runs the corresponding Effect API and rethrows `AIError` unchanged.
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
  | RequestExecutor.Service

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
    Layer.mergeAll(LLMClient.layer, ImageClient.layer).pipe(
      Layer.provideMerge(options.layer ?? RequestExecutor.fetchLayer),
    ),
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

  // The typed `generate`/`stream` overloads take a concrete input or a request, not the union; normalize once here.
  const llmRequest = (input: RequestInput | LLMRequest) => (input instanceof LLMRequest ? input : LLM.request(input))
  const imageRequest = (input: ImageRequestInput | ImageRequest) =>
    input instanceof ImageRequest ? input : Image.request(input)

  return {
    run,
    llm: {
      request: LLM.request,
      generate: <const Model extends LanguageModel>(
        input: RequestInput<Model> | LLMRequest,
        options?: RunOptions,
      ) => run(LLM.generate(llmRequest(input)), options),
      stream: <const Model extends LanguageModel>(input: RequestInput<Model> | LLMRequest, options?: RunOptions) =>
        iterate(LLM.stream(llmRequest(input)), options),
    },
    image: {
      request: Image.request,
      generate: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: RunOptions,
      ) => run(Image.generate(imageRequest(input)), options),
      stream: <const Model extends ImageModel>(
        input: ImageRequestInput<Model> | ImageRequest,
        options?: RunOptions,
      ) => iterate(Image.stream(imageRequest(input)), options),
    },
    dispose: () => runtime.dispose(),
  }
}

export type Client = ReturnType<typeof make>

/** Default client over `RequestExecutor.fetchLayer` for scripts; the runtime builds its layer on first use. */
export const ai = make()

export * as AI from "./promise.js"
