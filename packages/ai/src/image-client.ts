import { Context, Effect, Layer, Schema, Stream } from "effect"
import type { AwaitOptions } from "./generation.js"
import { MediaClient } from "./media-client.js"
import { RequestExecutor } from "./route/executor.js"
import { AIError, UnsupportedOperationError } from "./schema/index.js"
import type { ImageEvent, ImageJob, ImageModel, ImageRequest, ImageResponse, ImageStatus } from "./image.js"

/** `start`, `status`, `result` and `cancel` fail with `UnsupportedOperation` on inline and stream routes. */
export interface Interface
  extends Pick<MediaClient.Interface<ImageRequest, ImageEvent, ImageResponse>, "generate" | "stream"> {
  readonly start: (request: ImageRequest) => Effect.Effect<ImageJob, AIError>
  readonly status: (model: ImageModel, id: string) => Effect.Effect<ImageStatus, AIError>
  readonly result: (model: ImageModel, id: string) => Effect.Effect<ImageResponse, AIError>
  readonly cancel: (model: ImageModel, id: string) => Effect.Effect<void, AIError>
}

export class ImageClientService extends Context.Service<ImageClientService, Interface>()("@opencode/ImageClient") {}
export const Service = ImageClientService
export type Service = ImageClientService

const responseEvents = (response: ImageResponse) => [
  ...response.images.map((image, index) => ({ type: "image" as const, index, image })),
  { type: "finish" as const, usage: response.usage, providerMetadata: response.providerMetadata },
]

// A queued image route whose token isn't a string is a programmer defect, not a provider error.
const decodeID = (token: unknown) => Schema.decodeUnknownEffect(Schema.String)(token).pipe(Effect.orDie)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const media = MediaClient.operations<ImageRequest, ImageEvent, ImageResponse>(executor.execute, {
      modality: "image",
      responseEvents,
    })
    const attach = (model: ImageModel, id: string, operation: string) => {
      if (model.route.kind !== "queued") return Effect.fail(MediaClient.notQueued("image", model.route, operation))
      return model.route.attach(model, id, executor.execute)
    }
    return Service.of({
      generate: media.generate,
      stream: media.stream,
      start: (request) =>
        media.start(request).pipe(
          // The token, not the snapshot id, is what `status` and `result` decode; `ImageModel.fromRoute` makes it a string.
          Effect.flatMap((generation) => decodeID(generation.token)),
          Effect.map((id) => ({ id })),
        ),
      status: (model, id) =>
        attach(model, id, "status").pipe(
          Effect.flatMap((route) => route.status),
          Effect.map((snapshot) => ({ status: snapshot.status, progress: snapshot.progress })),
        ),
      result: (model, id) => attach(model, id, "result").pipe(Effect.flatMap((route) => route.result)),
      cancel: (model, id) =>
        attach(model, id, "cancel").pipe(
          Effect.flatMap(
            (route) =>
              route.cancel ??
              Effect.fail(
                new AIError({
                  reason: new UnsupportedOperationError({
                    operation: "image.cancel",
                    provider: model.provider,
                    route: model.route.id,
                    message: `${model.provider}/${model.route.id} has no way to cancel an image generation`,
                  }),
                }),
              ),
          ),
        ),
    })
  }),
)

export const ImageClient = {
  Service,
  layer,
  responseEvents,
  generate: (request: ImageRequest, options?: AwaitOptions) =>
    Service.use((client) => client.generate(request, options)),
  stream: (request: ImageRequest, options?: AwaitOptions) =>
    Stream.unwrap(Service.useSync((client) => client.stream(request, options))),
  start: (request: ImageRequest) => Service.use((client) => client.start(request)),
  status: (model: ImageModel, id: string) => Service.use((client) => client.status(model, id)),
  result: (model: ImageModel, id: string) => Service.use((client) => client.result(model, id)),
  cancel: (model: ImageModel, id: string) => Service.use((client) => client.cancel(model, id)),
} as const
