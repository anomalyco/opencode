export * as VideoGeneration from "./video-generation.js"

import { Media } from "@opencode/ai/effect"
import { VideoID, type VideoJob, type VideoRequest, type VideoRunning } from "@opencode/schema/generate"
import type { Model } from "@opencode/schema/model"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Clock, Context, Deferred, Duration, Effect, Exit, FiberMap, Layer, Option, Schedule, Schema } from "effect"
import { BlobStore } from "./blob-store.js"
import { Database } from "./database/database.js"
import { Generate } from "./generate.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { AbsolutePath } from "./schema.js"
import { SessionBlob } from "./session/blob.js"
import { SessionStored } from "./session/stored.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("VideoGeneration.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

const INTERVAL = Duration.seconds(5)
const DEADLINE = Duration.hours(2)
const RETENTION = Duration.toMillis(Duration.hours(24))

export interface Interface {
  /** Returns once the provider accepted the job; the server then polls it and stores the video under `blobs/`. */
  readonly start: (input: VideoRequest) => Effect.Effect<VideoRunning, Generate.Error>
  readonly get: (id: VideoID) => Effect.Effect<VideoJob, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/VideoGeneration") {}

/**
 * Jobs live in memory only: a restart forgets the running ones, and their videos are never collected. A video stored
 * before the restart stays readable by its `media:` ref until it expires.
 *
 * TODO: make the `job` table's session link optional (it is keyed by the session message that announces a result), so
 * these jobs can be recorded there and survive a restart.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const store = yield* BlobStore.Service
    const locations = yield* LocationServiceMap.Service
    // The same base-config Location the generate routes use.
    const base = locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* Global.Service).config) }))
    const fibers = yield* FiberMap.make<VideoID>()
    const jobs = new Map<VideoID, VideoJob>()

    const generate = <A>(run: (generate: Generate.Interface) => Effect.Effect<A, Generate.Error>) =>
      Generate.Service.pipe(
        Effect.flatMap(run),
        Effect.provide(base),
        Effect.catchTag("FileSystem.DirectoryNotFoundError", (error) =>
          Effect.fail(new Generate.UnavailableError({ message: `Location not found: ${error.directory}` })),
        ),
      )

    const ingest = Effect.fnUntraced(function* (id: VideoID, model: Model.Ref, providerID: string, retention: number) {
      const file = yield* generate((service) => service.video.result(model, providerID))
      const staged = yield* store.stage(id, file.stream)
      if (staged.bytes === 0)
        return yield* new Generate.ProviderRequestError({
          providerID: model.providerID,
          reason: "provider",
          message: "The provider returned an empty video",
        })
      const expiresAt = (yield* Clock.currentTimeMillis) + retention
      yield* store.commit(
        id,
        staged,
        SessionBlob.save(db, [
          {
            hash: staged.hash,
            mime: file.mime,
            bytes: staged.bytes,
            width: file.width,
            height: file.height,
            data: Buffer.alloc(0),
            expires_at: expiresAt,
          },
        ]),
      )
      return { id, status: "completed", media: [SessionStored.ref(staged.hash)], expiresAt } satisfies VideoJob
    })

    // A status read that fails is retried at the next interval: the provider may be briefly unavailable.
    const poll = (id: VideoID, model: Model.Ref, providerID: string) =>
      generate((service) => service.video.status(model, providerID)).pipe(
        Effect.map((status) => (status.status === "running" ? undefined : status)),
        Effect.catch((error) =>
          Effect.logWarning("video status read failed", { id, error: error.message }).pipe(Effect.as(undefined)),
        ),
        Effect.repeat({ schedule: Schedule.spaced(INTERVAL), until: (status) => status !== undefined }),
        Effect.timeoutOption(DEADLINE),
      )

    const settle = Effect.fnUntraced(function* (id: VideoID, model: Model.Ref, providerID: string, retention: number) {
      const settled = yield* poll(id, model, providerID)
      if (Option.isNone(settled) || settled.value === undefined)
        return {
          id,
          status: "error",
          reason: "unknown",
          error: `The provider had no result ${Duration.format(DEADLINE)} after submission`,
        } satisfies VideoJob
      if (settled.value.status === "error") {
        const reason = settled.value.reason ?? "failed"
        return { id, status: "error", reason, error: `The provider reported the job as ${reason}` } satisfies VideoJob
      }
      return yield* ingest(id, model, providerID, retention).pipe(
        Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
        Effect.catch((error) =>
          store
            .discard(id)
            .pipe(Effect.as({ id, status: "error", reason: "failed", error: error.message } satisfies VideoJob)),
        ),
      )
    })

    const start = Effect.fn("VideoGeneration.start")(function* (input: VideoRequest) {
      const id = VideoID.create()
      const retention = input.expiresAfter ?? RETENTION
      const submitted = yield* Deferred.make<VideoRunning, Generate.Error>()
      // Runs in the server's fibers, so a client that disconnects can't interrupt a paid submission midway.
      yield* FiberMap.run(
        fibers,
        id,
        Effect.gen(function* () {
          const started = yield* generate((service) =>
            service.video.start({
              ...input,
              start: input.start && Media.image(Media.base64(input.start.data, input.start.mime)),
              end: input.end && Media.image(Media.base64(input.end.data, input.end.mime)),
              references: input.references?.map((file) => Media.base64(file.data, file.mime)),
            }),
          )
          const running = { id, status: "running" } as const
          jobs.set(id, running)
          yield* Deferred.succeed(submitted, running)
          jobs.set(id, yield* settle(id, input.model, started.id, retention))
          // Forgotten with its video, so the map holds at most one retention's worth of jobs.
          yield* Effect.sleep(Duration.millis(retention))
          jobs.delete(id)
        }).pipe(
          // Once the submission succeeded, this does nothing.
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Deferred.failCause(submitted, exit.cause) : Effect.void)),
          Effect.ignore,
        ),
      )
      return yield* Deferred.await(submitted)
    })

    const get = Effect.fn("VideoGeneration.get")(function* (id: VideoID) {
      const job = jobs.get(id)
      if (job) return job
      return yield* new NotFoundError({ id, message: `Video generation not found: ${id}` })
    })

    return Service.of({ start, get })
  }),
)

/** Videos need `blobs/` on a local disk, which Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    start: () =>
      Effect.fail(new Generate.UnavailableError({ message: "Video generation is not supported in this runtime" })),
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Video generation not found: ${id}` })),
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, BlobStore.node, Global.node, LocationServiceMap.node],
})
