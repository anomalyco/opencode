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
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { and, eq } from "drizzle-orm"
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

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Generation.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

const INTERVAL = Duration.seconds(5)
const DEADLINE = Duration.hours(2)

export interface Interface {
  /** Returns once the provider accepted the job; the server then polls it and stores the video under `blobs/`. */
  readonly video: (input: VideoRequest) => Effect.Effect<VideoRunning, Generate.Error>
  readonly get: (id: GenerationID) => Effect.Effect<VideoJob, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Generation") {}

type Row = typeof GenerationTable.$inferSelect
type Job = Pick<Row, "id" | "model" | "retention" | "time_created"> & { readonly provider_job_id: string }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const store = yield* BlobStore.Service
    const locations = yield* LocationServiceMap.Service
    // The same base-config Location the generate routes use.
    const base = locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* Global.Service).config) }))
    const fibers = yield* FiberMap.make<GenerationID>()

    const generate = <A>(run: (generate: Generate.Interface) => Effect.Effect<A, Generate.Error>) =>
      Generate.Service.pipe(
        Effect.flatMap(run),
        Effect.provide(base),
        Effect.catchTag("FileSystem.DirectoryNotFoundError", (error) =>
          Effect.fail(new Generate.UnavailableError({ message: `Location not found: ${error.directory}` })),
        ),
      )

    const update = (id: GenerationID, set: Partial<typeof GenerationTable.$inferInsert>) =>
      db.update(GenerationTable).set(set).where(eq(GenerationTable.id, id)).run().pipe(Effect.orDie)

    const fail = (id: GenerationID, reason: VideoErrorReason, error: string) =>
      store.discard(id).pipe(Effect.andThen(update(id, { status: "error", reason, error })))

    // The blob row and `completed` are written together, so a completed job always names a stored video.
    const ingest = Effect.fnUntraced(function* (job: Job) {
      const file = yield* generate((service) => service.video.result(job.model, job.provider_job_id))
      const staged = yield* store.stage(job.id, file.stream)
      if (staged.bytes === 0)
        return yield* new Generate.ProviderRequestError({
          providerID: job.model.providerID,
          reason: "provider",
          message: "The provider returned an empty video",
        })
      const expires = (yield* Clock.currentTimeMillis) + job.retention
      yield* store.commit(
        job.id,
        staged,
        db
          .transaction(() =>
            Effect.gen(function* () {
              yield* SessionBlob.save(db, [
                {
                  hash: staged.hash,
                  mime: file.mime,
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

    // Failed reads are retried until the deadline: the provider or a plugin may be briefly unavailable.
    const check = (job: Job, retries = 0) =>
      generate((service) => service.video.status(job.model, job.provider_job_id)).pipe(
        Effect.retry({ times: retries, schedule: Schedule.exponential(INTERVAL) }),
        Effect.map((status) => (status.status === "running" ? undefined : status)),
        Effect.catch((error) =>
          Effect.logWarning("video status read failed", { id: job.id, error: error.message }).pipe(
            Effect.as(undefined),
          ),
        ),
      )

    const poll = Effect.fnUntraced(function* (job: Job) {
      // The first read runs whatever the deadline, retried through a brief failure: a job resumed after a long
      // restart may have finished, and been paid for.
      const first = yield* check(job, 3)
      const remaining = job.time_created + Duration.toMillis(DEADLINE) - (yield* Clock.currentTimeMillis)
      const settled =
        first === undefined
          ? yield* check(job).pipe(
              Effect.delay(INTERVAL),
              Effect.repeat({ schedule: Schedule.spaced(INTERVAL), until: (status) => status !== undefined }),
              Effect.timeoutOption(Duration.millis(Math.max(remaining, 0))),
            )
          : Option.some(first)
      if (Option.isNone(settled) || settled.value === undefined)
        return yield* fail(
          job.id,
          "unknown",
          `The provider had no result ${Duration.format(DEADLINE)} after submission`,
        )
      if (settled.value.status === "error") {
        const reason = settled.value.reason ?? "failed"
        return yield* fail(job.id, reason, `The provider reported the job as ${reason}`)
      }
      yield* ingest(job).pipe(
        Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
        Effect.catch((error) => fail(job.id, "failed", error.message)),
      )
    })

    const video = Effect.fn("Generation.video")(function* (input: VideoRequest) {
      const start = yield* frame(input.start, "start")
      const end = yield* frame(input.end, "end")
      const id = GenerationID.create()
      const retention = (input.expiresAfter ?? 24 * 60 * 60) * 1000
      // Recorded before the paid call: a restart that finds this row still submitting reports an unknown outcome
      // instead of submitting again.
      yield* db
        .insert(GenerationTable)
        .values({ id, kind: "video", model: input.model, status: "submitting", retention })
        .run()
        .pipe(Effect.orDie)
      const submitted = yield* Deferred.make<VideoRunning, Generate.Error>()
      // Runs in the server's fibers, so a client that disconnects can't interrupt a paid submission midway.
      yield* FiberMap.run(
        fibers,
        id,
        Effect.gen(function* () {
          const started = yield* generate((service) =>
            service.video.start({
              ...input,
              start,
              end,
              references: input.references?.map((file) => Media.base64(file.data, file.mime)),
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
            retention,
            provider_job_id: started.id,
            time_created: yield* Clock.currentTimeMillis,
          })
        }).pipe(
          // Once the submission succeeded, this does nothing.
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
      const expired = row.expires_at !== null && row.expires_at <= (yield* Clock.currentTimeMillis)
      if (row.status === "completed" && expired)
        return { id, status: "error", reason: "expired", error: "The generated video expired" } satisfies VideoJob
      if (row.status === "completed")
        return {
          id,
          status: "completed",
          media: (row.media ?? []).map(SessionStored.ref),
          expiresAt: row.expires_at ?? 0,
        } satisfies VideoJob
      if (row.status === "error")
        return {
          id,
          status: "error",
          reason: row.reason ?? "failed",
          error: row.error ?? "Video generation failed",
        } satisfies VideoJob
      return { id, status: "running" } satisfies VideoJob
    })

    // A submission cut off by a restart may or may not have been billed, so it is never submitted again.
    yield* db
      .update(GenerationTable)
      .set({
        status: "error",
        reason: "unknown",
        error: "The server stopped while submitting the job; it may or may not have started",
      })
      .where(eq(GenerationTable.status, "submitting"))
      .run()
      .pipe(Effect.orDie)
    const running = (yield* db
      .select()
      .from(GenerationTable)
      .where(eq(GenerationTable.status, "running"))
      .all()
      .pipe(Effect.orDie)).filter((row): row is Row & Job => row.provider_job_id !== null)
    // Providers load with plugins, so resuming earlier would fail every job with a missing model.
    if (running.length > 0)
      yield* Plugin.awaitActivation.pipe(
        Effect.provide(base),
        Effect.ignoreCause({ log: "Error", message: "Could not load providers to resume video generations" }),
        Effect.andThen(
          Effect.forEach(running, (job) => FiberMap.run(fibers, job.id, poll(job), { onlyIfMissing: true }), {
            discard: true,
          }),
        ),
        Effect.forkScoped,
      )

    return Service.of({ video, get })
  }),
)

// Frames are pinned images; `Media.image` throws on anything else.
function frame(file: File | undefined, field: "start" | "end") {
  if (file === undefined) return Effect.succeed(undefined)
  if (!file.mime.toLowerCase().startsWith("image/"))
    return Effect.fail(new Generate.InvalidRequestError({ message: `The ${field} frame must be an image`, field }))
  return Effect.succeed(Media.image(Media.base64(file.data, file.mime)))
}

/** Videos need `blobs/` on a local disk, which Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    video: () =>
      Effect.fail(new Generate.UnavailableError({ message: "Video generation is not supported in this runtime" })),
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Video generation not found: ${id}` })),
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, BlobStore.node, Global.node, LocationServiceMap.node],
})
