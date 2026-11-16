export * as Generation from "./generation.js"

import { Media } from "@opencode/ai/effect"
import {
  GenerationID,
  type File,
  type VideoErrorReason,
  type VideoJob,
  type VideoRequest,
  type VideoRunning,
} from "@opencode/schema/generate"
import type { Model } from "@opencode/schema/model"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { and, eq, isNull } from "drizzle-orm"
import { Clock, Context, Deferred, Duration, Effect, Exit, FiberMap, Layer, Option, Schedule, Schema } from "effect"
import { BlobStore } from "./blob-store.js"
import { Database } from "./database/database.js"
import { Generate } from "./generate.js"
import { GenerationTable } from "./generation/sql.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Plugin } from "./plugin.js"
import { AbsolutePath } from "./schema.js"
import { SessionBlob } from "./session/blob.js"
import { SessionStored } from "./session/stored.js"

export type Kind = "image" | "video"
/** `submitting` until the provider returns its job ID; clients see it as `running`. */
export type Status = "submitting" | "running" | "completed" | "error"

/** What a row keeps of its request. Input frames are not kept: nothing reads them after submission. */
export interface Request {
  readonly prompt: string
  readonly duration?: number
  readonly aspect?: string
  readonly resolution?: string
  readonly sound?: boolean
  /** Milliseconds the stored output stays available once the job completes. */
  readonly retention: number
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Generation.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export interface Options {
  /** Time between provider status reads. */
  readonly interval?: Duration.Input
  /** How long after submission a job may run before it is given up on. */
  readonly deadline?: Duration.Input
}

export const DEFAULT_RETENTION = Duration.hours(24)
const DEFAULT_INTERVAL = Duration.seconds(5)
const DEFAULT_DEADLINE = Duration.hours(2)
const OCTET_STREAM = "application/octet-stream"

export interface Interface {
  /**
   * Submits a video job and returns once the provider accepted it. The server then polls the job and stores the
   * video under `blobs/` before {@link Interface.get} reports it completed. Fails when the submission fails.
   */
  readonly video: (input: VideoRequest) => Effect.Effect<VideoRunning, Generate.Error>
  readonly get: (id: GenerationID) => Effect.Effect<VideoJob, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Generation") {}

type Row = typeof GenerationTable.$inferSelect
interface Job {
  readonly id: GenerationID
  readonly model: Model.Ref
  readonly providerJobID: string
  readonly request: Request
  readonly created: number
}

export const layer = (options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const store = yield* BlobStore.Service
      const locations = yield* LocationServiceMap.Service
      // Generation runs on the server's base configuration, the same Location the generate routes use.
      const base = locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* Global.Service).config) }))
      const fibers = yield* FiberMap.make<GenerationID>()
      const interval = Duration.fromInputUnsafe(options.interval ?? DEFAULT_INTERVAL)
      const deadline = Duration.toMillis(Duration.fromInputUnsafe(options.deadline ?? DEFAULT_DEADLINE))

      const generate = <A>(run: (generate: Generate.Interface) => Effect.Effect<A, Generate.Error>) =>
        Effect.gen(function* () {
          const service = yield* Generate.Service
          return yield* run(service)
        }).pipe(
          Effect.provide(base),
          Effect.catchTag("FileSystem.DirectoryNotFoundError", (error) =>
            Effect.fail(new Generate.UnavailableError({ message: `Location not found: ${error.directory}` })),
          ),
        )

      const update = (id: GenerationID, set: Partial<typeof GenerationTable.$inferInsert>) =>
        db.update(GenerationTable).set(set).where(eq(GenerationTable.id, id)).run().pipe(Effect.orDie)

      const fail = Effect.fnUntraced(function* (id: GenerationID, reason: VideoErrorReason, error: string) {
        yield* store.discard(id)
        yield* update(id, { status: "error", reason, error })
        yield* Effect.logWarning("video generation failed", { id, reason, error })
      })

      // Downloads the result into `blobs/`, then records the blob and the completed job together, so a completed job
      // always names a stored video.
      const ingest = Effect.fnUntraced(function* (job: Job) {
        const file = yield* generate((service) => service.video.result(job.model, job.providerJobID))
        const staged = yield* store.stage(job.id, file.stream)
        if (staged.bytes === 0) {
          yield* store.discard(job.id)
          return yield* new Generate.ProviderRequestError({
            providerID: job.model.providerID,
            reason: "provider",
            message: "The provider returned an empty video",
          })
        }
        const mime =
          file.mime === OCTET_STREAM ? (Media.detectMediaType(staged.head) ?? file.mime) : file.mime.toLowerCase()
        const expires = (yield* Clock.currentTimeMillis) + job.request.retention
        yield* store.commit(
          job.id,
          staged,
          db
            .transaction(() =>
              Effect.gen(function* () {
                yield* SessionBlob.save(db, [
                  {
                    hash: staged.hash,
                    mime,
                    bytes: staged.bytes,
                    width: file.width,
                    height: file.height,
                    data: Buffer.alloc(0),
                    expires_at: expires,
                  },
                ])
                yield* update(job.id, { status: "completed", media: [staged.hash], expires_at: expires })
              }),
            )
            .pipe(Effect.orDie),
        )
      })

      // A status read that fails is retried until the deadline; the provider or a plugin may be briefly unavailable.
      const check = (job: Job) =>
        generate((service) => service.video.status(job.model, job.providerJobID)).pipe(
          Effect.map((status) => (status.status === "running" ? undefined : status)),
          Effect.catch((error) =>
            Effect.logWarning("video status read failed", { id: job.id, error: error.message }).pipe(
              Effect.as(undefined),
            ),
          ),
        )

      const poll = Effect.fnUntraced(function* (job: Job) {
        // The first read runs whatever the deadline: a job resumed after a long restart may have finished, and paid.
        const first = yield* check(job)
        const remaining = job.created + deadline - (yield* Clock.currentTimeMillis)
        const settled =
          first === undefined
            ? yield* check(job).pipe(
                Effect.delay(interval),
                Effect.repeat({ schedule: Schedule.spaced(interval), until: (status) => status !== undefined }),
                Effect.timeoutOption(Duration.millis(Math.max(remaining, 0))),
              )
            : Option.some(first)
        if (settled._tag === "None")
          return yield* fail(
            job.id,
            "unknown",
            `The provider had no result ${Duration.format(Duration.millis(deadline))} after submission`,
          )
        const status = settled.value
        if (status === undefined) return
        if (status.status === "error")
          return yield* fail(
            job.id,
            status.reason ?? "failed",
            `The provider reported the job as ${status.reason ?? "failed"}`,
          )
        yield* ingest(job).pipe(
          Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
          Effect.catch((error) => fail(job.id, "failed", error.message)),
        )
      })

      const watch = (job: Job) => FiberMap.run(fibers, job.id, poll(job), { onlyIfMissing: true })

      const video = Effect.fn("Generation.video")(function* (input: VideoRequest) {
        const frames = yield* videoFrames(input)
        const id = GenerationID.create()
        const request: Request = {
          prompt: input.prompt,
          duration: input.duration,
          aspect: input.aspect,
          resolution: input.resolution,
          sound: input.sound,
          retention:
            input.expiresAfter === undefined ? Duration.toMillis(DEFAULT_RETENTION) : input.expiresAfter * 1000,
        }
        // Recorded before the paid call: a restart that finds this row still submitting reports an unknown outcome
        // instead of submitting again.
        yield* db
          .insert(GenerationTable)
          .values({ id, kind: "video", model: input.model, status: "submitting", request })
          .run()
          .pipe(Effect.orDie)
        const submitted = yield* Deferred.make<VideoRunning, Generate.Error>()
        // The submission runs in the server's fibers, so a client that disconnects can't interrupt it midway.
        yield* FiberMap.run(
          fibers,
          id,
          Effect.gen(function* () {
            const started = yield* generate((service) =>
              service.video.start({
                model: input.model,
                prompt: input.prompt,
                ...frames,
                duration: input.duration,
                aspect: input.aspect,
                resolution: input.resolution,
                sound: input.sound,
              }),
            ).pipe(
              Effect.tapError((error) =>
                // Without an HTTP status the request may still have reached the provider.
                update(id, {
                  status: "error",
                  reason:
                    error._tag === "Generate.ProviderRequestError" && error.status === undefined ? "unknown" : "failed",
                  error: error.message,
                }),
              ),
            )
            yield* update(id, { status: "running", provider_job_id: started.id })
            yield* Deferred.succeed(submitted, { id, status: "running" } as const)
            yield* poll({
              id,
              model: input.model,
              providerJobID: started.id,
              request,
              created: yield* Clock.currentTimeMillis,
            })
          }).pipe(
            // Completes the request with the submission's failure; once it succeeded, this does nothing.
            Effect.onExit((exit) => (Exit.isFailure(exit) ? Deferred.failCause(submitted, exit.cause) : Effect.void)),
            Effect.ignore,
          ),
        )
        return yield* Deferred.await(submitted)
      })

      const get = Effect.fn("Generation.get")(function* (id: GenerationID) {
        const row = yield* db
          .select()
          .from(GenerationTable)
          .where(and(eq(GenerationTable.id, id), eq(GenerationTable.kind, "video")))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ id, message: `Video generation not found: ${id}` })
        return view(row, yield* Clock.currentTimeMillis)
      })

      // Recovery: a job whose submission was cut off may or may not have been billed, so it is never submitted again.
      yield* db
        .update(GenerationTable)
        .set({
          status: "error",
          reason: "unknown",
          error: "The server stopped while submitting the job; it may or may not have started",
        })
        .where(and(eq(GenerationTable.status, "submitting"), isNull(GenerationTable.provider_job_id)))
        .run()
        .pipe(Effect.orDie)
      const running = yield* db
        .select()
        .from(GenerationTable)
        .where(eq(GenerationTable.status, "running"))
        .all()
        .pipe(Effect.orDie)
      // Providers load with plugins, so resuming earlier would fail every job with a missing model.
      if (running.length > 0)
        yield* Plugin.awaitActivation.pipe(
          Effect.provide(base),
          Effect.ignoreCause({ log: "Error", message: "Could not load providers to resume video generations" }),
          Effect.andThen(Effect.forEach(running.flatMap(toJob), watch, { discard: true })),
          Effect.forkScoped,
        )

      return Service.of({ video, get })
    }),
  )

function toJob(row: Row): Job[] {
  if (row.provider_job_id === null) return []
  return [
    {
      id: row.id,
      model: row.model,
      providerJobID: row.provider_job_id,
      request: row.request,
      created: row.time_created,
    },
  ]
}

function view(row: Row, now: number): VideoJob {
  if (row.status === "completed" && row.expires_at !== null && row.expires_at <= now)
    return { id: row.id, status: "error", reason: "expired", error: "The generated video expired" }
  if (row.status === "completed")
    return {
      id: row.id,
      status: "completed",
      media: (row.media ?? []).map(SessionStored.ref),
      expiresAt: row.expires_at ?? now,
    }
  if (row.status === "error")
    return {
      id: row.id,
      status: "error",
      reason: row.reason ?? "failed",
      error: row.error ?? "Video generation failed",
    }
  return { id: row.id, status: "running" }
}

const videoFrames = Effect.fnUntraced(function* (input: VideoRequest) {
  const start = yield* frame(input.start, "start")
  const end = yield* frame(input.end, "end")
  return {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
    ...(input.references === undefined
      ? {}
      : { references: input.references.map((file) => Media.base64(file.data, file.mime)) }),
  }
})

// Frames are pinned images; `Media.image` throws on anything else, so other types are rejected here first.
function frame(file: File | undefined, field: "start" | "end") {
  if (file === undefined) return Effect.succeed(undefined)
  if (!file.mime.toLowerCase().startsWith("image/"))
    return Effect.fail(new Generate.InvalidRequestError({ message: `The ${field} frame must be an image`, field }))
  return Effect.succeed(Media.image(Media.base64(file.data, file.mime)))
}

/** Video generation needs `blobs/` on a local disk; Durable Objects have none yet. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    video: () =>
      Effect.fail(new Generate.UnavailableError({ message: "Video generation is not supported in this runtime" })),
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Video generation not found: ${id}` })),
  }),
)

export function configured(options?: Options) {
  return makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [Database.node, BlobStore.node, Global.node, LocationServiceMap.node],
  })
}

export const node = configured()
