export * as VideoGeneration from "./video-generation.js"

import path from "path"
import { Media } from "@opencode/ai/effect"
import { VideoID, type VideoJob, type VideoRequest, type VideoRunning } from "@opencode/schema/generate"
import type { Model } from "@opencode/schema/model"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Duration, Effect, Exit, FiberMap, Layer, Option, Schedule, Schema, Stream } from "effect"
import { FileRetention } from "./file-retention.js"
import { Job } from "./job.js"
import { Session } from "./session.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { Generate } from "./generate.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { AbsolutePath } from "./schema.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("VideoGeneration.NotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export const RETENTION = Duration.days(7)
/** Finished videos are objects named by their ID, with no extension; their type is read from their first bytes. */
export const DIRECTORY = "objects"
const INTERVAL = Duration.seconds(5)
const DEADLINE = Duration.hours(2)

/** A stored video: where it is, what it is and when it goes. */
export interface Content {
  readonly path: string
  readonly mime: string
  readonly bytes: number
  readonly expiresAt: number
}

/** A session-linked job a restarted server takes back from its `job` row. */
export interface Resume {
  readonly id: VideoID
  readonly sessionID: SessionSchema.ID
  readonly notificationID: SessionMessage.ID
  readonly model: Model.Ref
  readonly providerJobID: string
}

export interface Interface {
  /** Returns once the provider accepted the job; the server then polls it and stores the video under `objects/`. */
  readonly start: (input: VideoRequest) => Effect.Effect<VideoRunning, Generate.Error | Session.NotFoundError>
  readonly resume: (input: Resume) => Effect.Effect<void>
  readonly get: (id: VideoID) => Effect.Effect<VideoJob, NotFoundError>
  readonly content: (id: VideoID) => Effect.Effect<Content, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/VideoGeneration") {}

/**
 * Jobs without a session live in memory only: a restart forgets the running ones, and their videos are never
 * collected. A finished video stays readable by its ID until it expires. Jobs linked to a session run on the `job`
 * table instead: a restarted server polls them again (`resume`), and the session gets a notice when they end.
 *
 * TODO: make the `job` table's session link optional, so jobs without a session can be recorded there too.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const background = yield* Job.Service
    const sessions = yield* Session.Service
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const directory = path.join(global.data, DIRECTORY)
    // The same base-config Location the generate routes use.
    const base = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    const fibers = yield* FiberMap.make<VideoID>()
    const jobs = new Map<VideoID, VideoJob>()
    const file = (id: VideoID) => path.join(directory, id)
    const part = (id: VideoID) => `${file(id)}.part`

    const generate = <A>(run: (generate: Generate.Interface) => Effect.Effect<A, Generate.Error>) =>
      Generate.Service.pipe(
        Effect.flatMap(run),
        Effect.provide(base),
        Effect.catchTag("FileSystem.DirectoryNotFoundError", (error) =>
          Effect.fail(new Generate.UnavailableError({ message: `Location not found: ${error.directory}` })),
        ),
      )

    const content = Effect.fn("VideoGeneration.content")(function* (id: VideoID) {
      const missing = new NotFoundError({ id, message: `Video not found: ${id}` })
      const info = yield* fs.stat(file(id)).pipe(Effect.mapError(() => missing))
      const written = Option.getOrUndefined(info.mtime)?.getTime() ?? 0
      const head = yield* fs.stream(file(id), { bytesToRead: 64 }).pipe(
        Stream.runCollect,
        Effect.mapError(() => missing),
      )
      return {
        path: file(id),
        mime: Media.detectMediaType(Buffer.concat([...head])) ?? "application/octet-stream",
        bytes: Number(info.size),
        expiresAt: written + Duration.toMillis(RETENTION),
      }
    })

    // Written to `<id>.part`, synced, then renamed, so a stored object is always whole.
    const store = Effect.fnUntraced(function* (id: VideoID, model: Model.Ref, providerID: string) {
      const video = yield* generate((service) => service.video.result(model, providerID))
      yield* fs.makeDirectory(directory, { recursive: true })
      const bytes = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* fs.open(part(id), { flag: "w", mode: 0o600 })
          const total = yield* video.stream.pipe(
            Stream.runFoldEffect(
              () => 0,
              (total, chunk) => handle.writeAll(chunk).pipe(Effect.as(total + chunk.byteLength)),
            ),
          )
          yield* handle.sync
          return total
        }),
      )
      if (bytes === 0)
        return yield* new Generate.ProviderRequestError({
          providerID: model.providerID,
          reason: "provider",
          message: "The provider returned an empty video",
        })
      yield* fs.rename(part(id), file(id))
      const stored = yield* content(id).pipe(Effect.orDie)
      return {
        id,
        status: "completed",
        mime: stored.mime,
        bytes: stored.bytes,
        expiresAt: stored.expiresAt,
      } satisfies VideoJob
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
          fs
            .remove(part(id), { force: true })
            .pipe(
              Effect.ignore,
              Effect.as({ id, status: "error", reason: "failed", error: error.message } satisfies VideoJob),
            ),
        ),
      )
    })

    // Forgotten with its video, so the map holds at most one retention's worth of jobs.
    const forget = (id: VideoID) => Effect.sleep(RETENTION).pipe(Effect.andThen(Effect.sync(() => jobs.delete(id))))

    // Settles on the `job` table, so a restart resumes polling, then tells the session how it ended without waking its
    // agent. `get` still answers from memory while this process runs.
    const track = Effect.fnUntraced(function* (input: Resume) {
      jobs.set(input.id, { id: input.id, status: "running" })
      const model = `${input.model.providerID}/${input.model.id}`
      yield* background.start({
        id: input.id,
        notificationID: input.notificationID,
        type: "video",
        title: input.id,
        metadata: { sessionID: input.sessionID, model },
        recovery: {
          kind: "video",
          sessionID: input.sessionID,
          videoID: input.id,
          model,
          providerJobID: input.providerJobID,
        },
        background: true,
        run: settle(input.id, input.model, input.providerJobID).pipe(
          Effect.tap((job) => Effect.sync(() => jobs.set(input.id, job))),
          Effect.flatMap((job) =>
            job.status === "completed"
              ? Effect.succeed(`Video ${input.id} is ready (${job.mime}, ${job.bytes} bytes).`)
              : Effect.fail(new Error(job.error)),
          ),
        ),
      })
      const info = (yield* background.wait({ id: input.id })).info
      if (!info || info.status === "running") return
      const delivered = yield* sessions
        .synthetic({
          id: input.notificationID,
          sessionID: input.sessionID,
          description: "Video generation",
          text: notice({
            id: input.id,
            state: info.status,
            body:
              info.status === "completed" ? (info.output ?? "") : (info.error ?? `Video ${input.id} was cancelled.`),
          }),
          metadata: { source: "video_generate", jobID: input.id, state: info.status },
          resume: false,
        })
        .pipe(
          Effect.as(true),
          // A deleted session is owed nothing. Any other failure keeps the job row, so a restart delivers it.
          Effect.catchTag("Session.NotFoundError", () => Effect.succeed(true)),
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not deliver a video notice", { id: input.id, cause }).pipe(Effect.as(false)),
          ),
        )
      if (delivered) yield* background.completeBackground(input.notificationID)
    })

    const resume = (input: Resume) =>
      FiberMap.run(fibers, input.id, track(input).pipe(Effect.andThen(forget(input.id))), { onlyIfMissing: true }).pipe(
        Effect.asVoid,
      )

    const start = Effect.fn("VideoGeneration.start")(function* (input: VideoRequest) {
      if (input.sessionID !== undefined) yield* sessions.get(input.sessionID)
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
          // Once settled, `get` reads the stored object, or the error until the job is forgotten.
          if (input.sessionID !== undefined)
            yield* track({
              id,
              sessionID: input.sessionID,
              notificationID: SessionMessage.ID.create(),
              model: input.model,
              providerJobID: started.id,
            })
          else jobs.set(id, yield* settle(id, input.model, started.id))
          yield* forget(id)
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
      if (job && job.status !== "completed") return job
      // A finished video is read from its object, so it survives a restart and is gone once cleaned up.
      const stored = yield* content(id)
      return {
        id,
        status: "completed",
        mime: stored.mime,
        bytes: stored.bytes,
        expiresAt: stored.expiresAt,
      } satisfies VideoJob
    })

    // Objects and leftover `.part` files are deleted once older than the retention, at startup and hourly.
    const cleanup = fs.readDirectory(directory).pipe(
      Effect.map((entries) => entries.filter((entry) => entry.startsWith("video_"))),
      Effect.orElseSucceed((): string[] => []),
      Effect.flatMap((entries) =>
        FileRetention.cleanup(
          fs,
          entries.map((entry) => path.join(directory, entry)),
          RETENTION,
        ),
      ),
    )
    yield* cleanup.pipe(
      Effect.ignoreCause({ log: "Error", message: "Video cleanup failed" }),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.forkScoped,
    )

    return Service.of({ start, resume, get, content })
  }),
)

/** The notice a session gets when its video job ends, tagged with the video's ID like `<image id=…>` notices. */
export function notice(input: { id: string; state: string; body: string }) {
  return `<video id="${input.id}" state="${input.state}">\n${input.body}\n</video>`
}

/** Videos need a local disk for `objects/`, which Durable Objects don't have. */
export const unsupportedLayer = Layer.succeed(
  Service,
  Service.of({
    start: () =>
      Effect.fail(new Generate.UnavailableError({ message: "Video generation is not supported in this runtime" })),
    resume: () => Effect.void,
    get: (id) => Effect.fail(new NotFoundError({ id, message: `Video not found: ${id}` })),
    content: (id) => Effect.fail(new NotFoundError({ id, message: `Video not found: ${id}` })),
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, LocationServiceMap.node, Job.node, Session.node],
})
