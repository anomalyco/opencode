import { Context, Effect, Layer } from "effect"
import { RequestExecutor } from "./route/executor.js"
import { AIError, UnsupportedOperationError } from "./schema/index.js"
import type { VideoJob, VideoModel, VideoRequest, VideoResponse, VideoStatus } from "./video.js"

export interface Interface {
  readonly start: (request: VideoRequest) => Effect.Effect<VideoJob, AIError>
  readonly status: (model: VideoModel, token: unknown) => Effect.Effect<VideoStatus, AIError>
  readonly result: (model: VideoModel, token: unknown) => Effect.Effect<VideoResponse, AIError>
  readonly cancel: (model: VideoModel, token: unknown) => Effect.Effect<void, AIError>
}

export class VideoClientService extends Context.Service<VideoClientService, Interface>()("@opencode/VideoClient") {}
export const Service = VideoClientService
export type Service = VideoClientService

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const attach = (model: VideoModel, token: unknown) => model.route.attach(model, token, executor.execute)
    return Service.of({
      start: (request) =>
        request.model.route
          .start(request, executor.execute)
          .pipe(Effect.map((generation) => ({ id: generation.id, token: generation.token }))),
      status: (model, token) =>
        attach(model, token).pipe(
          Effect.flatMap((route) => route.status),
          Effect.map((snapshot) => ({ status: snapshot.status, progress: snapshot.progress })),
        ),
      result: (model, token) => attach(model, token).pipe(Effect.flatMap((route) => route.result)),
      cancel: (model, token) =>
        attach(model, token).pipe(
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
  status: (model: VideoModel, token: unknown) => Service.use((client) => client.status(model, token)),
  result: (model: VideoModel, token: unknown) => Service.use((client) => client.result(model, token)),
  cancel: (model: VideoModel, token: unknown) => Service.use((client) => client.cancel(model, token)),
} as const
