import { Context, Effect, Layer, Schema } from "effect"
import { RequestExecutor } from "./route/executor.js"
import { AIError, UnsupportedOperationError } from "./schema/index.js"
import type { VideoJob, VideoModel, VideoRequest, VideoResponse, VideoStatus } from "./video.js"

export interface Interface {
  readonly start: (request: VideoRequest) => Effect.Effect<VideoJob, AIError>
  readonly status: (model: VideoModel, id: string) => Effect.Effect<VideoStatus, AIError>
  readonly result: (model: VideoModel, id: string) => Effect.Effect<VideoResponse, AIError>
  readonly cancel: (model: VideoModel, id: string) => Effect.Effect<void, AIError>
}

export class VideoClientService extends Context.Service<VideoClientService, Interface>()("@opencode/VideoClient") {}
export const Service = VideoClientService
export type Service = VideoClientService

// A video route whose token isn't a string is a programmer defect, not a provider error.
const decodeID = (token: unknown) => Schema.decodeUnknownEffect(Schema.String)(token).pipe(Effect.orDie)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const attach = (model: VideoModel, id: string) => model.route.attach(model, id, executor.execute)
    return Service.of({
      start: (request) =>
        request.model.route.start(request, executor.execute).pipe(
          // The token, not the snapshot id, is what `status` and `result` decode; `VideoModel.fromRoute` makes it a string.
          Effect.flatMap((generation) => decodeID(generation.token)),
          Effect.map((id) => ({ id })),
        ),
      status: (model, id) =>
        attach(model, id).pipe(
          Effect.flatMap((route) => route.status),
          Effect.map((snapshot) => ({ status: snapshot.status, progress: snapshot.progress })),
        ),
      result: (model, id) => attach(model, id).pipe(Effect.flatMap((route) => route.result)),
      cancel: (model, id) =>
        attach(model, id).pipe(
          Effect.flatMap(
            (route) =>
              route.cancel ??
              Effect.fail(
                new AIError({
                  reason: new UnsupportedOperationError({
                    operation: "video.cancel",
                    provider: model.provider,
                    route: model.route.id,
                    message: `${model.provider}/${model.route.id} has no way to cancel a video generation`,
                  }),
                }),
              ),
          ),
        ),
    })
  }),
)

export const VideoClient = {
  Service,
  layer,
  start: (request: VideoRequest) => Service.use((client) => client.start(request)),
  status: (model: VideoModel, id: string) => Service.use((client) => client.status(model, id)),
  result: (model: VideoModel, id: string) => Service.use((client) => client.result(model, id)),
  cancel: (model: VideoModel, id: string) => Service.use((client) => client.cancel(model, id)),
} as const
