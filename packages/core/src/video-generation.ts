export * as VideoGeneration from "./video-generation.js"

import { randomUUID } from "node:crypto"
import { and, eq, lte, sql } from "drizzle-orm"
import { Media } from "@opencode/ai/effect"
import {
  VideoErrorReason,
  VideoID,
  type VideoJob,
  type VideoRequest,
  type VideoRunning,
} from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Clock, Context, Deferred, Duration, Effect, Exit, FiberMap, Layer, Option, Schedule, Schema } from "effect"
import { BlobStore } from "./blob-store.js"
import { Database } from "./database/database.js"
import { Generate } from "./generate.js"
import { KV } from "./kv.js"
import { KVTable } from "./kv/sql.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { AbsolutePath } from "./schema.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("VideoGeneration.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

const INTERVAL = Duration.seconds(5)
const DEADLINE = Duration.hours(2)
/** How long a finished job's record is kept. Its blobs keep their own retention. */
const RETENTION = Duration.hours(24)
const PREFIX = "video:"
/**
 * A server polls a job only while it holds the job's lease, so servers sharing a database never poll the same job, and
 * one takes over the jobs of a server that stopped within about a minute.
 */
const LEASE = "video-lease:"
const TTL = Duration.minutes(1)

export interface StartOptions {
  /** Where the model and its credentials are resolved; defaults to the server's base configuration. */
  readonly location?: Location.Ref
}

export interface Interface {
  /** Returns once the provider accepted the job; the server then polls it and stores the videos as blobs. */
  readonly start: (input: VideoRequest, options?: StartOptions) => Effect.Effect<VideoRunning, Generate.Error>
  readonly get: (id: VideoID) => Effect.Effect<VideoJob, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/VideoGeneration") {}

// `remote` is the provider's ID for the job; it never leaves this service.
const fields = { model: Model.Ref, location: Location.Ref, created: Schema.Finite }
const Job = Schema.Union([
  Schema.Struct({ status: Schema.Literal("submitting"), ...fields }),
  Schema.Struct({ status: Schema.Literal("running"), remote: Schema.String, ...fields }),
  Schema.Struct({
    status: Schema.Literal("completed"),
    blobs: Schema.Array(BlobStore.ID),
    finished: Schema.Finite,
    ...fields,
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    reason: VideoErrorReason,
    error: Schema.String,
    finished: Schema.Finite,
    ...fields,
  }),
])
type Job = typeof Job.Type
type Running = Extract<Job, { status: "running" }>
type Outcome =
  | { readonly status: "completed"; readonly blobs: readonly BlobStore.ID[] }
  | { readonly status: "error"; readonly reason: VideoErrorReason; readonly error: string }

const decode = Schema.decodeUnknownOption(Job)
const encode = Schema.encodeSync(Job)
const decodeID = Schema.decodeUnknownOption(VideoID)

/**
 * Each job is a record in kv under `video:<id>`, written before the provider is called, so a restart resumes polling
 * running jobs and fails the ones whose submission it interrupted. Records are deleted 24 hours after the job finished.
 * Only the server holding a job's lease works on it.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const blobs = yield* BlobStore.Service
    const kv = yield* KV.Service
    const db = (yield* Database.Service).db
    const owner = randomUUID()
    // The same base-config Location the generate routes use.
    const base = Location.Ref.make({ directory: AbsolutePath.make(global.config) })
    const fibers = yield* FiberMap.make<VideoID>()

    const save = (id: VideoID, job: Job) => kv.set(PREFIX + id, encode(job))

    // Takes the lease if it's free, expired or already ours.
    const claim = Effect.fnUntraced(function* (id: VideoID) {
      const now = yield* Clock.currentTimeMillis
      const value = { owner, until: now + Duration.toMillis(TTL) }
      const claimed = yield* db
        .insert(KVTable)
        .values({ key: LEASE + id, value, time_created: now, time_updated: now })
        .onConflictDoUpdate({
          target: KVTable.key,
          set: { value, time_updated: now },
          where: sql`json_extract(${KVTable.value}, '$.owner') = ${owner} or json_extract(${KVTable.value}, '$.until') <= ${now}`,
        })
        .returning({ key: KVTable.key })
        .get()
        .pipe(Effect.orDie)
      return claimed !== undefined
    })

    const release = (id: VideoID) =>
      db
        .delete(KVTable)
        .where(and(eq(KVTable.key, LEASE + id), sql`json_extract(${KVTable.value}, '$.owner') = ${owner}`))
        .run()
        .pipe(Effect.ignore)

    // Runs the work while renewing its lease, and stops it if another server took the lease over.
    const hold = <A, E>(id: VideoID, work: Effect.Effect<A, E>) =>
      Effect.raceFirst(
        work,
        claim(id).pipe(
          Effect.repeat({ schedule: Schedule.spaced(Duration.seconds(30)), while: (held) => held }),
          Effect.andThen(Effect.logWarning("video lease lost", { id })),
          Effect.andThen(Effect.interrupt),
        ),
      ).pipe(Effect.ensuring(release(id)))

    const finish = (id: VideoID, job: Job, outcome: Outcome) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((finished) =>
          save(id, { model: job.model, location: job.location, created: job.created, ...outcome, finished }),
        ),
      )

    const generate = <A>(
      location: Location.Ref,
      run: (generate: Generate.Interface) => Effect.Effect<A, Generate.Error>,
    ) =>
      Generate.Service.pipe(
        Effect.flatMap(run),
        Effect.provide(locations.get(location)),
        Effect.catchTag("FileSystem.DirectoryNotFoundError", (error) =>
          Effect.fail(new Generate.UnavailableError({ message: `Location not found: ${error.directory}` })),
        ),
      )

    // All or nothing: a job never reports only some of its videos.
    const download = Effect.fnUntraced(function* (job: Running) {
      const videos = yield* generate(job.location, (service) => service.video.result(job.model, job.remote))
      const written: BlobStore.ID[] = []
      yield* Effect.forEach(videos, (video) =>
        blobs.write(video.stream).pipe(
          Effect.tap((blob) => Effect.sync(() => written.push(blob.id))),
          Effect.flatMap((blob) =>
            blob.bytes > 0
              ? Effect.void
              : Effect.fail(
                  new Generate.ProviderRequestError({
                    providerID: job.model.providerID,
                    reason: "provider",
                    message: "The provider returned an empty video",
                  }),
                ),
          ),
        ),
      ).pipe(Effect.onError(() => Effect.forEach(written, blobs.remove, { discard: true })))
      return written
    })

    // A status read that fails is retried at the next interval: the provider may be briefly unavailable.
    const poll = (id: VideoID, job: Running, left: Duration.Duration) =>
      generate(job.location, (service) => service.video.status(job.model, job.remote)).pipe(
        Effect.map((status) => (status.status === "running" ? undefined : status)),
        Effect.catch((error) =>
          Effect.logWarning("video status read failed", { id, error: error.message }).pipe(Effect.as(undefined)),
        ),
        Effect.repeat({ schedule: Schedule.spaced(INTERVAL), until: (status) => status !== undefined }),
        Effect.timeoutOption(left),
        Effect.map((status) => Option.getOrUndefined(status)),
      )

    const settle = Effect.fnUntraced(function* (id: VideoID, job: Running) {
      const left = job.created + Duration.toMillis(DEADLINE) - (yield* Clock.currentTimeMillis)
      const settled = left > 0 ? yield* poll(id, job, Duration.millis(left)) : undefined
      if (settled === undefined)
        return yield* finish(id, job, {
          status: "error",
          reason: "unknown",
          error: `The provider had no result ${Duration.format(DEADLINE)} after submission`,
        })
      if (settled.status === "error") {
        const reason = settled.reason ?? "failed"
        return yield* finish(id, job, { status: "error", reason, error: `The provider reported the job as ${reason}` })
      }
      const outcome = yield* download(job).pipe(
        Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
        Effect.map((written): Outcome => ({ status: "completed", blobs: written })),
        Effect.catch((error) => Effect.succeed<Outcome>({ status: "error", reason: "failed", error: error.message })),
      )
      yield* finish(id, job, outcome)
    })

    const start = Effect.fn("VideoGeneration.start")(function* (input: VideoRequest, options?: StartOptions) {
      const id = VideoID.create()
      const submitted = yield* Deferred.make<VideoRunning, Generate.Error>()
      const job = {
        status: "submitting",
        model: input.model,
        location: options?.location ?? base,
        created: yield* Clock.currentTimeMillis,
      } satisfies Job
      // Runs in the server's fibers, so a client that disconnects can't interrupt a paid submission midway.
      yield* claim(id)
      yield* FiberMap.run(
        fibers,
        id,
        hold(
          id,
          Effect.gen(function* () {
            yield* save(id, job)
            // A rejected submission's ID is never returned, so its record is dropped.
            const started = yield* generate(job.location, (service) =>
              service.video.start({
                ...input,
                start: input.start && Media.image(Media.base64(input.start.data, input.start.mime)),
                end: input.end && Media.image(Media.base64(input.end.data, input.end.mime)),
                references: input.references?.map((file) => Media.base64(file.data, file.mime)),
              }),
            ).pipe(Effect.tapError(() => kv.remove(PREFIX + id)))
            const running = { ...job, status: "running", remote: started.id } satisfies Running
            yield* save(id, running)
            yield* Deferred.succeed(submitted, { id, status: "running" } as const)
            yield* settle(id, running)
          }),
        ).pipe(
          // Once the submission succeeded, this does nothing.
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Deferred.failCause(submitted, exit.cause) : Effect.void)),
          Effect.ignore,
        ),
      )
      return yield* Deferred.await(submitted)
    })

    const get = Effect.fn("VideoGeneration.get")(function* (id: VideoID) {
      const missing = new NotFoundError({ id, message: `Video not found: ${id}` })
      const stored = yield* kv.get(PREFIX + id)
      const job = stored === undefined ? undefined : Option.getOrUndefined(decode(stored))
      if (!job || expired(job, yield* Clock.currentTimeMillis)) return yield* missing
      if (job.status === "submitting" || job.status === "running") return { id, status: "running" } satisfies VideoJob
      if (job.status === "error")
        return { id, status: "error", reason: job.reason, error: job.error } satisfies VideoJob
      // A blob that expired or was deleted is dropped.
      const found = yield* Effect.forEach(job.blobs, (blob) => blobs.read(blob).pipe(Effect.option))
      const infos = found.flatMap((blob) =>
        Option.isSome(blob) ? [{ id: blob.value.id, mime: blob.value.mime, bytes: blob.value.bytes }] : [],
      )
      if (infos.length === 0) return yield* missing
      return { id, status: "completed", blobs: infos } satisfies VideoJob
    })

    const rows = Effect.gen(function* () {
      const found: KV.Entry[] = []
      let after: string | undefined
      while (true) {
        const page = yield* kv.scan({ prefix: PREFIX, after, limit: 500 })
        found.push(...page.entries)
        if (!page.next) return found
        after = page.next
      }
    })

    // At startup and every minute, take over unfinished jobs nobody holds: a running job is polled again until its
    // deadline. A submission the server stopped is never resent: it's paid and not idempotent, so whether the provider
    // got it is unknown.
    const adopt = Effect.gen(function* () {
      yield* Effect.forEach(
        yield* rows,
        (row) =>
          Effect.gen(function* () {
            const id = Option.getOrUndefined(decodeID(row.key.slice(PREFIX.length)))
            const seen = Option.getOrUndefined(decode(row.value))
            if (!id || !seen || (seen.status !== "running" && seen.status !== "submitting")) return
            if (yield* FiberMap.has(fibers, id)) return
            if (!(yield* claim(id))) return
            // Read again under the lease: the previous owner may have finished the job since the scan.
            const stored = yield* kv.get(PREFIX + id)
            const job = stored === undefined ? undefined : Option.getOrUndefined(decode(stored))
            if (!job || (job.status !== "running" && job.status !== "submitting")) return yield* release(id)
            if (job.status === "running")
              return yield* FiberMap.run(fibers, id, hold(id, settle(id, job)).pipe(Effect.ignore))
            yield* finish(id, job, {
              status: "error",
              reason: "unknown",
              error: "The server stopped while submitting the job; its outcome is unknown",
            }).pipe(Effect.ensuring(release(id)))
          }),
        { discard: true },
      )
    })
    yield* adopt
    yield* adopt.pipe(
      Effect.ignoreCause({ log: "Error", message: "Video job takeover failed" }),
      Effect.repeat(Schedule.spaced(TTL)),
      Effect.delay(TTL),
      Effect.forkScoped,
    )

    // Records that can't be read are removed with the expired ones.
    yield* Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      yield* Effect.forEach(
        yield* rows,
        (row) => {
          const job = Option.getOrUndefined(decode(row.value))
          return !job || expired(job, now) ? kv.remove(row.key) : Effect.void
        },
        { discard: true },
      )
      // A lease outlives its job only when its server stopped after the job finished.
      yield* db
        .delete(KVTable)
        .where(
          and(
            sql`${KVTable.key} like ${LEASE + "%"}`,
            lte(sql`json_extract(${KVTable.value}, '$.until')`, now - Duration.toMillis(RETENTION)),
          ),
        )
        .run()
        .pipe(Effect.ignore)
    }).pipe(
      Effect.ignoreCause({ log: "Error", message: "Video record cleanup failed" }),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.forkScoped,
    )

    return Service.of({ start, get })
  }),
)

// A job that never recorded finishing is treated as finished at its deadline.
function expired(job: Job, now: number) {
  const finished =
    job.status === "completed" || job.status === "error" ? job.finished : job.created + Duration.toMillis(DEADLINE)
  return finished + Duration.toMillis(RETENTION) <= now
}

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
  deps: [BlobStore.node, Database.node, Global.node, KV.node, LocationServiceMap.node],
})
