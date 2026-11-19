export * as VideoGeneration from "./video-generation.js"

import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import {
  type VideoCompleted,
  type VideoError,
  VideoErrorReason,
  VideoID,
  type VideoJob,
  type VideoRunning,
} from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { makeGlobalNode, Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Clock, Context, Duration, Effect, Fiber, FiberMap, Layer, Option, Schedule, Schema } from "effect"
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
/** How long a finished job's record is kept. Its blobs are kept for good. */
const RETENTION = Duration.hours(24)
const PREFIX = "video:"
/**
 * One server per database polls and downloads every job: the one holding this lease, elected like the automation
 * scheduler. Any server submits jobs and answers reads. Outside `PREFIX`, so record scans never see it.
 */
const LEADER = "video-leader"
const TTL = Duration.minutes(1)

export interface StartOptions {
  /** Where the model and its credentials are resolved; defaults to the server's base configuration. */
  readonly location?: Location.Ref
}

export interface Interface {
  /** Returns once the provider accepted the job; the server then polls it and stores the videos as blobs. */
  readonly start: (input: Generate.VideoInput, options?: StartOptions) => Effect.Effect<VideoRunning, Generate.Error>
  readonly get: (id: VideoID) => Effect.Effect<VideoJob, NotFoundError>
  /** Waits until the job completes or fails, whichever server polls it. */
  readonly wait: (id: VideoID) => Effect.Effect<VideoCompleted | VideoError, NotFoundError>
  /** Fails a running job as cancelled, and asks the provider to cancel it if it can. */
  readonly cancel: (id: VideoID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/VideoGeneration") {}

// `remote` is the provider's ID for the job; it never leaves this service.
const fields = { model: Model.Ref, location: Location.Ref, created: Schema.Finite }
const Job = Schema.Union([
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
 * Each job is a record in kv under `video:<id>`, written once the provider accepted it, so a restart resumes polling.
 * Every 5 seconds each server drops records 24 hours after their job finished, and while jobs are running, tries for
 * the lease. The one holding it checks each running job once.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const blobs = yield* BlobStore.Service
    const kv = yield* KV.Service
    const db = (yield* Database.Service).db
    const scope = yield* Effect.scope
    const owner = randomUUID()
    // The same base-config Location the generate routes use.
    const base = Location.Ref.make({ directory: AbsolutePath.make(global.config) })
    const checks = yield* FiberMap.make<VideoID>()

    const load = (id: VideoID) =>
      kv
        .get(PREFIX + id)
        .pipe(Effect.map((stored) => (stored === undefined ? undefined : Option.getOrUndefined(decode(stored)))))

    // Takes the lease if it's free, expired or already ours.
    const claim = Effect.fnUntraced(function* () {
      const now = yield* Clock.currentTimeMillis
      const value = { owner, until: now + Duration.toMillis(TTL) }
      const claimed = yield* db
        .insert(KVTable)
        .values({ key: LEADER, value, time_created: now, time_updated: now })
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

    yield* Effect.addFinalizer(() =>
      db
        .delete(KVTable)
        .where(and(eq(KVTable.key, LEADER), sql`json_extract(${KVTable.value}, '$.owner') = ${owner}`))
        .run()
        .pipe(Effect.ignore),
    )

    // Writes the outcome only if the job is still running; one cancelled meanwhile, possibly by another server, keeps
    // its record and drops what this one downloaded.
    const finish = Effect.fnUntraced(function* (id: VideoID, job: Running, outcome: Outcome) {
      const now = yield* Clock.currentTimeMillis
      const value = encode({
        model: job.model,
        location: job.location,
        created: job.created,
        ...outcome,
        finished: now,
      })
      const updated = yield* db
        .update(KVTable)
        .set({ value, time_updated: now })
        .where(and(eq(KVTable.key, PREFIX + id), sql`json_extract(${KVTable.value}, '$.status') = 'running'`))
        .returning({ key: KVTable.key })
        .get()
        .pipe(Effect.orDie)
      if (updated === undefined && outcome.status === "completed")
        yield* Effect.forEach(outcome.blobs, blobs.remove, { discard: true })
    })

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

    // A status read that fails is tried again at the next check: the provider may be briefly unavailable.
    const check = Effect.fnUntraced(function* (id: VideoID, job: Running, now: number) {
      if (now >= job.created + Duration.toMillis(DEADLINE))
        return yield* finish(id, job, {
          status: "error",
          reason: "unknown",
          error: `The provider had no result ${Duration.format(DEADLINE)} after submission`,
        })
      const status = yield* generate(job.location, (service) => service.video.status(job.model, job.remote)).pipe(
        Effect.catch((error) =>
          Effect.logWarning("video status read failed", { id, error: error.message }).pipe(
            Effect.as({ status: "running" } as const),
          ),
        ),
      )
      if (status.status === "running") return
      if (status.status === "error") {
        const reason = status.reason ?? "failed"
        return yield* finish(id, job, { status: "error", reason, error: `The provider reported the job as ${reason}` })
      }
      const outcome = yield* download(job).pipe(
        Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
        Effect.map((written): Outcome => ({ status: "completed", blobs: written })),
        Effect.catch((error) => Effect.succeed<Outcome>({ status: "error", reason: "failed", error: error.message })),
      )
      yield* finish(id, job, outcome)
    })

    const start = Effect.fn("VideoGeneration.start")(function* (input: Generate.VideoInput, options?: StartOptions) {
      const location = options?.location ?? base
      const submit = Effect.gen(function* () {
        const started = yield* generate(location, (service) => service.video.start(input))
        const id = VideoID.create()
        const created = yield* Clock.currentTimeMillis
        yield* kv.set(
          PREFIX + id,
          encode({ status: "running", remote: started.id, model: input.model, location, created }),
        )
        return { id, status: "running" } as const
      })
      // Runs in the server's scope, so a client that disconnects can't interrupt a paid submission midway.
      return yield* Fiber.join(yield* submit.pipe(Effect.forkIn(scope, { startImmediately: true })))
    })

    const get = Effect.fn("VideoGeneration.get")(function* (id: VideoID) {
      const missing = new NotFoundError({ id, message: `Video not found: ${id}` })
      const job = yield* load(id)
      if (!job || expired(job, yield* Clock.currentTimeMillis)) return yield* missing
      if (job.status === "running") return { id, status: "running" } satisfies VideoJob
      if (job.status === "error")
        return { id, status: "error", reason: job.reason, error: job.error } satisfies VideoJob
      // A deleted blob is dropped.
      const found = yield* Effect.forEach(job.blobs, (blob) => blobs.read(blob).pipe(Effect.option))
      const infos = found.flatMap((blob) =>
        Option.isSome(blob) ? [{ id: blob.value.id, mime: blob.value.mime, bytes: blob.value.bytes }] : [],
      )
      if (infos.length === 0) return yield* missing
      return { id, status: "completed", blobs: infos } satisfies VideoJob
    })

    // Reads the record, so it works whichever server polls the job.
    const wait = (id: VideoID): Effect.Effect<VideoCompleted | VideoError, NotFoundError> =>
      Effect.gen(function* () {
        const job = yield* get(id)
        if (job.status !== "running") return job
        yield* Effect.sleep(INTERVAL)
        return yield* wait(id)
      })

    const cancel = Effect.fn("VideoGeneration.cancel")(function* (id: VideoID) {
      const job = yield* load(id)
      if (!job) return yield* new NotFoundError({ id, message: `Video not found: ${id}` })
      if (job.status !== "running") return
      yield* FiberMap.remove(checks, id)
      yield* finish(id, job, { status: "error", reason: "cancelled", error: "The video generation was cancelled" })
      // Best effort: some providers can't cancel, and the paid job then runs to completion on their side.
      yield* generate(job.location, (service) => service.video.cancel(job.model, job.remote)).pipe(Effect.ignore)
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

    // Records that can't be read are removed with the expired ones. A claim that fails, such as on a busy database,
    // counts as not leading, so two servers never poll at once; losing the lease stops this server's checks.
    const tick = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const running = (yield* Effect.forEach(yield* rows, (row) => {
        const id = Option.getOrUndefined(decodeID(row.key.slice(PREFIX.length)))
        const job = Option.getOrUndefined(decode(row.value))
        if (!job || expired(job, now)) return kv.remove(row.key).pipe(Effect.as([]))
        return Effect.succeed(id && job.status === "running" ? [{ id, job }] : [])
      })).flat()
      const leading =
        running.length > 0 &&
        (yield* claim().pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("video leader claim failed", { cause }).pipe(Effect.as(false)),
          ),
        ))
      if (!leading) return yield* FiberMap.clear(checks)
      yield* Effect.forEach(
        running,
        (entry) =>
          FiberMap.run(checks, entry.id, check(entry.id, entry.job, now).pipe(Effect.ignore), { onlyIfMissing: true }),
        { discard: true },
      )
    })
    yield* tick.pipe(
      Effect.ignoreCause({ log: "Error", message: "Video job check failed" }),
      Effect.repeat(Schedule.spaced(INTERVAL)),
      Effect.forkScoped,
    )

    return Service.of({ start, get, wait, cancel })
  }),
)

// A job that never recorded finishing is treated as finished at its deadline.
function expired(job: Job, now: number) {
  const finished = job.status === "running" ? job.created + Duration.toMillis(DEADLINE) : job.finished
  return finished + Duration.toMillis(RETENTION) <= now
}

/** Videos are stored as blobs, which need a local disk that Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    start: () =>
      Effect.fail(new Generate.UnavailableError({ message: "Video generation is not supported in this runtime" })),
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Video not found: ${id}` })),
    wait: (id) => Effect.fail(new NotFoundError({ id, message: `Video not found: ${id}` })),
    cancel: (id) => Effect.fail(new NotFoundError({ id, message: `Video not found: ${id}` })),
  }),
)

// Typed by hand: the Location services this reads include this service, so its type can't be inferred.
export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [BlobStore.node, Database.node, Global.node, KV.node, LocationServiceMap.node],
})
