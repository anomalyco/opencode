export * as ImageGeneration from "./image-generation.js"

import { and, eq, sql } from "drizzle-orm"
import { isReadonlyArrayNonEmpty } from "effect/Array"
import {
  type ImageCompleted,
  type ImageError,
  ImageErrorReason,
  ImageID,
  type ImageJob,
  type ImageRequest,
  type ImageRunning,
} from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { makeGlobalNode, Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Clock, Context, Duration, Effect, Fiber, FiberMap, Layer, Option, Schedule, Schema, Stream } from "effect"
import { BlobStore } from "./blob-store.js"
import { Database } from "./database/database.js"
import { Generate } from "./generate.js"
import { KV } from "./kv.js"
import { KVTable } from "./kv/sql.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { AbsolutePath } from "./schema.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("ImageGeneration.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

const INTERVAL = Duration.seconds(5)
/** The longest a request runs; a job still running a minute after this lost its server. */
const DEADLINE = Duration.minutes(30)
/** How long a finished job's record is kept. Its blobs are kept for good. */
const RETENTION = Duration.hours(24)
const PREFIX = "image:"

export interface StartOptions {
  /** Where the model and its credentials are resolved; defaults to the server's base configuration. */
  readonly location?: Location.Ref
}

export interface Interface {
  /** Returns once the model is known to make images; this server then makes the request and stores them as blobs. */
  readonly start: (input: ImageRequest, options?: StartOptions) => Effect.Effect<ImageRunning, Generate.Error>
  readonly get: (id: ImageID) => Effect.Effect<ImageJob, NotFoundError>
  /** Waits until the job completes or fails, whichever server reads it. */
  readonly wait: (id: ImageID) => Effect.Effect<ImageCompleted | ImageError, NotFoundError>
  /** Fails a running job as cancelled, and stops its request when this server is making it. */
  readonly cancel: (id: ImageID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ImageGeneration") {}

const fields = { model: Model.Ref, location: Location.Ref, created: Schema.Finite }
const Job = Schema.Union([
  Schema.Struct({ status: Schema.Literal("running"), ...fields }),
  Schema.Struct({
    status: Schema.Literal("completed"),
    blobs: Schema.Array(BlobStore.ID),
    finished: Schema.Finite,
    ...fields,
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    reason: ImageErrorReason,
    error: Schema.String,
    finished: Schema.Finite,
    ...fields,
  }),
])
type Job = typeof Job.Type
type Running = Extract<Job, { status: "running" }>
type Outcome =
  | { readonly status: "completed"; readonly blobs: readonly BlobStore.ID[] }
  | { readonly status: "error"; readonly reason: ImageErrorReason; readonly error: string }

const decode = Schema.decodeUnknownOption(Job)
const encode = Schema.encodeSync(Job)
const decodeID = Schema.decodeUnknownOption(ImageID)

/**
 * Each job is a record in kv under `image:<id>`. Image providers answer in one request, with no job to resume, so the
 * server that took a job makes the request itself; one that stopped mid-request leaves its job to fail at the deadline.
 * Every 5 seconds each server drops records 24 hours after their job finished.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const blobs = yield* BlobStore.Service
    const kv = yield* KV.Service
    const db = (yield* Database.Service).db
    // The same base-config Location the generate routes use.
    const base = Location.Ref.make({ directory: AbsolutePath.make(global.config) })
    // In the server's scope, so a client that disconnects can't interrupt a paid request midway.
    const requests = yield* FiberMap.make<ImageID>()

    const load = (id: ImageID) =>
      kv
        .get(PREFIX + id)
        .pipe(Effect.map((stored) => (stored === undefined ? undefined : Option.getOrUndefined(decode(stored)))))

    // Writes the outcome only if the job is still running; one cancelled meanwhile, possibly by another server, keeps
    // its record and drops what this one stored.
    const finish = Effect.fnUntraced(function* (id: ImageID, job: Running, outcome: Outcome) {
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

    // All or nothing: a job never reports only some of its images.
    const store = Effect.fnUntraced(function* (job: Running, input: ImageRequest) {
      const result = yield* generate(job.location, (service) => service.image(input))
      if (result.images.length === 0)
        return yield* new Generate.ProviderRequestError({
          providerID: job.model.providerID,
          reason: "provider",
          message: `${job.model.providerID}/${job.model.id} returned no image`,
        })
      const written: BlobStore.ID[] = []
      yield* Effect.forEach(result.images, (image) =>
        blobs
          .write(Stream.make(Buffer.from(image.data, "base64")))
          .pipe(Effect.tap((blob) => Effect.sync(() => written.push(blob.id)))),
      ).pipe(Effect.onError(() => Effect.forEach(written, blobs.remove, { discard: true })))
      return written
    })

    const run = (id: ImageID, job: Running, input: ImageRequest) =>
      store(job, input).pipe(
        Effect.timeoutOrElse({
          duration: DEADLINE,
          orElse: () =>
            Effect.fail(new Error(`The provider had no result ${Duration.format(DEADLINE)} after the request`)),
        }),
        Effect.map((written): Outcome => ({ status: "completed", blobs: written })),
        Effect.catch((error) => Effect.succeed<Outcome>({ status: "error", reason: "failed", error: error.message })),
        Effect.flatMap((outcome) => finish(id, job, outcome)),
      )

    const start = Effect.fn("ImageGeneration.start")(function* (input: ImageRequest, options?: StartOptions) {
      const location = options?.location ?? base
      yield* generate(location, (service) => service.checkImage(input.model))
      const id = ImageID.create()
      const job = {
        status: "running",
        model: input.model,
        location,
        created: yield* Clock.currentTimeMillis,
      } satisfies Running
      yield* kv.set(PREFIX + id, encode(job))
      yield* FiberMap.run(requests, id, run(id, job, input).pipe(Effect.ignore))
      return { id, status: "running" } as const
    })

    const get = Effect.fn("ImageGeneration.get")(function* (id: ImageID) {
      const missing = new NotFoundError({ id, message: `Image not found: ${id}` })
      const job = yield* load(id)
      if (!job || expired(job, yield* Clock.currentTimeMillis)) return yield* missing
      if (job.status === "running") return { id, status: "running" } satisfies ImageJob
      if (job.status === "error")
        return { id, status: "error", reason: job.reason, error: job.error } satisfies ImageJob
      // A deleted blob is dropped.
      const found = yield* Effect.forEach(job.blobs, (blob) => blobs.read(blob).pipe(Effect.option))
      const infos = found.flatMap((blob) =>
        Option.isSome(blob) ? [{ id: blob.value.id, mime: blob.value.mime, bytes: blob.value.bytes }] : [],
      )
      if (!isReadonlyArrayNonEmpty(infos)) return yield* missing
      return { id, status: "completed", blobs: infos } satisfies ImageJob
    })

    // Reads the record, so it works whichever server makes the request; when this one does, it waits for the request.
    const wait = (id: ImageID): Effect.Effect<ImageCompleted | ImageError, NotFoundError> =>
      Effect.gen(function* () {
        const job = yield* get(id)
        if (job.status !== "running") return job
        const request = yield* FiberMap.get(requests, id)
        yield* Option.isSome(request) ? Fiber.await(request.value) : Effect.sleep(INTERVAL)
        return yield* wait(id)
      })

    const cancel = Effect.fn("ImageGeneration.cancel")(function* (id: ImageID) {
      const job = yield* load(id)
      if (!job) return yield* new NotFoundError({ id, message: `Image not found: ${id}` })
      if (job.status !== "running") return
      yield* FiberMap.remove(requests, id)
      yield* finish(id, job, { status: "error", reason: "cancelled", error: "The image generation was cancelled" })
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

    // Records that can't be read are removed with the expired ones.
    const tick = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      yield* Effect.forEach(
        yield* rows,
        (row) => {
          const id = Option.getOrUndefined(decodeID(row.key.slice(PREFIX.length)))
          const job = Option.getOrUndefined(decode(row.value))
          if (!job || expired(job, now)) return kv.remove(row.key)
          if (!id || job.status !== "running" || now < job.created + Duration.toMillis(DEADLINE) + 60_000)
            return Effect.void
          return finish(id, job, {
            status: "error",
            reason: "unknown",
            error: "The server generating this image stopped before it finished",
          })
        },
        { discard: true },
      )
    })
    yield* tick.pipe(
      Effect.ignoreCause({ log: "Error", message: "Image job check failed" }),
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

/** Images are stored as blobs, which need a local disk that Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    start: () =>
      Effect.fail(new Generate.UnavailableError({ message: "Image generation is not supported in this runtime" })),
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Image not found: ${id}` })),
    wait: (id) => Effect.fail(new NotFoundError({ id, message: `Image not found: ${id}` })),
    cancel: (id) => Effect.fail(new NotFoundError({ id, message: `Image not found: ${id}` })),
  }),
)

// Typed by hand: the Location services this reads include this service, so its type can't be inferred.
export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [BlobStore.node, Database.node, Global.node, KV.node, LocationServiceMap.node],
})
