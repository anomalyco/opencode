import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Clock, Deferred, Duration, Effect, Layer, Stream } from "effect"
import type { VideoStatus } from "@opencode/ai/effect"
import { TestClock } from "effect/testing"
import { BlobStore } from "@opencode/core/blob-store"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Generate } from "@opencode/core/generate"
import { Generation } from "@opencode/core/generation"
import { GenerationTable } from "@opencode/core/generation/sql"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { BlobTable } from "@opencode/core/session/sql"
import { GenerationID, type VideoJob } from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { eventually } from "./lib/eventually"

const model = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("video") })
const video = new TextEncoder().encode("a small mp4")

/** A provider the test drives: what status reads return, and what the result streams. */
interface Provider {
  starts: number
  status: VideoStatus
  result: Stream.Stream<Uint8Array, Generate.Error>
  start?: Effect.Effect<Generate.VideoJob, Generate.Error>
  reads: number
  /** Holds status reads until it opens. */
  gate?: Deferred.Deferred<void>
}

const provider = (): Provider => ({ starts: 0, reads: 0, status: { status: "running" }, result: Stream.make(video) })

const generateNode = (state: Provider) =>
  makeLocationNode({
    service: Generate.Service,
    layer: Layer.succeed(
      Generate.Service,
      Generate.Service.of({
        text: () => Effect.die("unused"),
        image: () => Effect.die("unused"),
        decisions: () => Effect.die("unused"),
        video: {
          start: () =>
            Effect.suspend(() => {
              state.starts++
              return state.start ?? Effect.succeed({ id: "provider_1" })
            }),
          status: () =>
            Effect.suspend(() => {
              state.reads++
              return state.gate === undefined ? Effect.void : Deferred.await(state.gate)
            }).pipe(Effect.map(() => state.status)),
          result: () => Effect.sync(() => ({ mime: "video/mp4", stream: state.result })),
          cancel: () => Effect.die("unused"),
        },
      }),
    ),
    deps: [],
  })

// One server process over `dir`: closing its scope and building it again is a restart.
const app = (dir: string, state: Provider, options?: Generation.Options) =>
  AppNodeBuilder.build(LayerNode.group([Generation.node, BlobStore.node, Database.node, LocationServiceMap.node]), [
    Global.node.replace(
      Global.layerWith({
        data: path.join(dir, "data"),
        cache: path.join(dir, "cache"),
        config: path.join(dir, "config"),
        state: path.join(dir, "state"),
        tmp: path.join(dir, "tmp"),
        bin: path.join(dir, "cache", "bin"),
        log: path.join(dir, "data", "log"),
        repos: path.join(dir, "data", "repos"),
      }),
    ),
    Database.node.replace(Database.configured({ path: "opencode.db" })),
    offlineModels,
    Watcher.node.replace(Watcher.configured({ enabled: false })),
    Generate.node.replace(generateNode(state)),
    Generation.node.replace(Generation.configured(options)),
  ])

const settled = (id: GenerationID, step: Duration.Input = "5 seconds") =>
  eventually(
    Effect.gen(function* () {
      const generations = yield* Generation.Service
      yield* TestClock.adjust(step)
      return yield* generations.get(id)
    }),
    (job: VideoJob) => job.status !== "running",
  )

const exists = (file: string) =>
  Effect.promise(() =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  )

it.effect("stores a finished video under blobs/ before reporting it completed", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-")).path
    const state = provider()
    yield* Effect.gen(function* () {
      const generations = yield* Generation.Service
      const store = yield* BlobStore.Service
      const { db } = yield* Database.Service
      const started = yield* generations.video({ model, prompt: "a cat" })
      expect(started.status).toBe("running")
      expect(state.starts).toBe(1)
      expect(
        yield* db
          .select({ status: GenerationTable.status, provider: GenerationTable.provider_job_id })
          .from(GenerationTable)
          .where(eq(GenerationTable.id, started.id))
          .get(),
      ).toEqual({ status: "running", provider: "provider_1" })
      expect(yield* generations.get(started.id)).toEqual({ id: started.id, status: "running" })

      state.status = { status: "completed" }
      const job = yield* settled(started.id)
      const now = yield* Clock.currentTimeMillis
      if (job.status !== "completed") throw new Error(`expected completed, got ${JSON.stringify(job)}`)
      const hash = job.media[0]!.slice("media:".length)
      expect(job.expiresAt).toBeGreaterThan(now + 23 * 60 * 60 * 1000)
      const blob = yield* db.select().from(BlobTable).where(eq(BlobTable.hash, hash)).get()
      expect(blob).toMatchObject({ mime: "video/mp4", bytes: video.byteLength, expires_at: job.expiresAt })
      expect(blob?.data.byteLength).toBe(0)
      expect(yield* Effect.promise(() => fs.readFile(store.path(hash), "utf8"))).toBe("a small mp4")
      expect(yield* exists(path.join(dir, "data", "blobs", `${started.id}.part`))).toBe(false)
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("after a restart, fails a job cut off while submitting and resumes a running one by its provider ID", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-restart-")).path
    const state = provider()
    const submitting = GenerationID.create()
    const running = GenerationID.create()
    yield* Effect.gen(function* () {
      const { db } = yield* Database.Service
      const request = { prompt: "a dog", retention: 60_000 }
      yield* db
        .insert(GenerationTable)
        .values([
          { id: submitting, kind: "video", model, status: "submitting", request },
          { id: running, kind: "video", model, status: "running", provider_job_id: "provider_9", request },
        ])
        .run()
    }).pipe(Effect.provide(app(dir, state)))

    state.status = { status: "completed" }
    yield* Effect.gen(function* () {
      const generations = yield* Generation.Service
      expect(yield* generations.get(submitting)).toMatchObject({ status: "error", reason: "unknown" })
      expect(yield* settled(running)).toMatchObject({ status: "completed" })
      expect(state.starts).toBe(0)
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("reads a resumed job's status once even when the server was down past its deadline", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-late-")).path
    const state = provider()
    const late = GenerationID.create()
    yield* Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(GenerationTable)
        .values({
          id: late,
          kind: "video",
          model,
          status: "running",
          provider_job_id: "provider_late",
          request: { prompt: "a fox", retention: 60_000 },
          time_created: 0,
        })
        .run()
    }).pipe(Effect.provide(app(dir, state)))

    // Down for three hours, past the 2 hour deadline; the provider finished meanwhile. The first read is slow, so
    // time passes while it is in flight, and a deadline would win.
    yield* TestClock.adjust("3 hours")
    state.status = { status: "completed" }
    const gate = yield* Deferred.make<void>()
    state.gate = gate
    yield* Effect.gen(function* () {
      yield* eventually(
        Effect.sync(() => state.reads),
        (reads) => reads > 0,
      )
      yield* TestClock.adjust("1 second")
      yield* Deferred.succeed(gate, undefined)
      expect(yield* settled(late)).toMatchObject({ status: "completed" })
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("deletes the staged file and reports an error when the download keeps failing", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-fail-")).path
    const state = provider()
    state.result = Stream.make(video).pipe(
      Stream.concat(
        Stream.fail(
          new Generate.ProviderRequestError({ providerID: "test", reason: "provider", message: "connection reset" }),
        ),
      ),
    )
    yield* Effect.gen(function* () {
      const generations = yield* Generation.Service
      const { db } = yield* Database.Service
      const started = yield* generations.video({ model, prompt: "a bird" })
      state.status = { status: "completed" }
      expect(yield* settled(started.id, "1 second")).toEqual({
        id: started.id,
        status: "error",
        reason: "failed",
        error: "connection reset",
      })
      expect(yield* exists(path.join(dir, "data", "blobs", `${started.id}.part`))).toBe(false)
      expect(yield* db.select().from(BlobTable).all()).toEqual([])
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("reports the provider's failure reason, a failed submission, and a job past its deadline", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-errors-")).path
    const state = provider()
    yield* Effect.gen(function* () {
      const generations = yield* Generation.Service
      const expired = yield* generations.video({ model, prompt: "a fish" })
      state.status = { status: "error", reason: "expired" }
      expect(yield* settled(expired.id)).toMatchObject({ status: "error", reason: "expired" })

      state.status = { status: "running" }
      const slow = yield* generations.video({ model, prompt: "a snail" })
      expect(yield* settled(slow.id, "30 seconds")).toMatchObject({ status: "error", reason: "unknown" })

      state.start = Effect.fail(
        new Generate.ProviderRequestError({
          providerID: "test",
          reason: "invalid_request",
          message: "bad",
          status: 400,
        }),
      )
      const rejected = yield* generations.video({ model, prompt: "a crab" }).pipe(Effect.flip)
      expect(rejected).toMatchObject({ _tag: "Generate.ProviderRequestError", message: "bad" })
    }).pipe(Effect.provide(app(dir, state, { deadline: "1 minute" })))
  }),
)
