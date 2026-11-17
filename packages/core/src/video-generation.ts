export * as VideoGeneration from "./video-generation.js"

import { Media } from "@opencode/ai/effect"
import { VideoID, type VideoJob, type VideoRequest, type VideoRunning } from "@opencode/schema/generate"
import type { Model } from "@opencode/schema/model"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Duration, Effect, Exit, FiberMap, Layer, Option, Schedule, Schema } from "effect"
import { BlobStore } from "./blob-store.js"
import { Generate } from "./generate.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { AbsolutePath } from "./schema.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("VideoGeneration.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

const INTERVAL = Duration.seconds(5)
const DEADLINE = Duration.hours(2)

export interface Interface {
  /** Returns once the provider accepted the job; the server then polls it and stores the video as a blob. */
  readonly start: (input: VideoRequest) => Effect.Effect<VideoRunning, Generate.Error>
  readonly get: (id: VideoID) => Effect.Effect<VideoJob, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/VideoGeneration") {}

/**
 * Running and failed jobs live in memory only: a restart forgets them, and a running job's videos are never collected.
 * A finished job is read from its blobs, so it outlives a restart until they expire.
 *
 * TODO: record jobs durably, so a restart resumes polling them.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const blobs = yield* BlobStore.Service
    // The same base-config Location the generate routes use.
    const base = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
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

    // Each video becomes blob `<id>_<n>`, so a restarted server finds them from the job's ID alone.
    const blobID = (id: VideoID, index: number) => BlobStore.ID.make(`${id}_${index}`)

    const store = Effect.fnUntraced(function* (id: VideoID, model: Model.Ref, providerID: string) {
      const videos = yield* generate((service) => service.video.result(model, providerID))
      const stored = yield* Effect.forEach(videos, (video, index) =>
        blobs.write(blobID(id, index), video.stream).pipe(
          Effect.flatMap((blob) =>
            blob.bytes > 0
              ? Effect.succeed(blob)
              : Effect.fail(
                  new Generate.ProviderRequestError({
                    providerID: model.providerID,
                    reason: "provider",
                    message: "The provider returned an empty video",
                  }),
                ),
          ),
        ),
      ).pipe(
        // All or nothing: a job never reports only some of its videos.
        Effect.onError(() => Effect.forEach(videos, (_, index) => blobs.remove(blobID(id, index)), { discard: true })),
      )
      return { id, status: "completed", blobs: stored } satisfies VideoJob
    })

    // A finished job outlives a restart through its blobs: `<id>_0`, `<id>_1`, … up to the first missing one.
    const stored = (id: VideoID): Effect.Effect<readonly BlobStore.Info[]> =>
      Effect.gen(function* () {
        const found: BlobStore.Info[] = []
        while (true) {
          const blob = yield* blobs.read(blobID(id, found.length)).pipe(Effect.option)
          if (Option.isNone(blob)) return found
          found.push({
            id: blob.value.id,
            mime: blob.value.mime,
            bytes: blob.value.bytes,
            expiresAt: blob.value.expiresAt,
          })
        }
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

    const settle = Effect.fnUntraced(function* (id: VideoID, model: Model.Ref, providerID: string) {
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
      return yield* store(id, model, providerID).pipe(
        Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
        Effect.catch((error) =>
          Effect.succeed({ id, status: "error", reason: "failed", error: error.message } satisfies VideoJob),
        ),
      )
    })

    const start = Effect.fn("VideoGeneration.start")(function* (input: VideoRequest) {
      const id = VideoID.create()
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
          const settled = yield* settle(id, input.model, started.id)
          // A finished job's blobs are its record from here on.
          if (settled.status === "completed") return jobs.delete(id)
          // A failure is kept as long as a blob would be, so the map holds at most one retention's worth of jobs.
          jobs.set(id, settled)
          yield* Effect.sleep(BlobStore.RETENTION)
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
      const found = yield* stored(id)
      if (found.length === 0) return yield* new NotFoundError({ id, message: `Video not found: ${id}` })
      return { id, status: "completed", blobs: found } satisfies VideoJob
    })

    return Service.of({ start, get })
  }),
)

/** Videos are stored as blobs, which need a local disk that Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    start: () =>
      Effect.fail(new Generate.UnavailableError({ message: "Video generation is not supported in this runtime" })),
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Video not found: ${id}` })),
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [BlobStore.node, Global.node, LocationServiceMap.node],
})
