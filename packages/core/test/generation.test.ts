import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Clock, Deferred, type Duration, Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { VideoStatus } from "@opencode/ai/effect"
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
const providerError = (message: string, status?: number) =>
  new Generate.ProviderRequestError({ providerID: "test", reason: "provider", message, status })

/** A provider the test drives. */
const provider = () => ({
  starts: 0,
  reads: 0,
  status: { status: "running" } as VideoStatus,
  result: Stream.make(new TextEncoder().encode("a small mp4")) as Stream.Stream<Uint8Array, Generate.Error>,
  start: Effect.succeed({ id: "provider_1" }) as Effect.Effect<{ readonly id: string }, Generate.Error>,
  /** Status reads that fail before one succeeds. */
  failReads: 0,
  /** Holds status reads until it opens. */
  gate: undefined as Deferred.Deferred<void> | undefined,
})
type State = ReturnType<typeof provider>

// One server process over `dir`: providing it again is a restart.
const app = (dir: string, state: State) =>
  AppNodeBuilder.build(LayerNode.group([Generation.node, BlobStore.node, Database.node, LocationServiceMap.node]), [
    Global.node.replace(Global.layerWith({ data: path.join(dir, "data"), config: path.join(dir, "config") })),
    Database.node.replace(Database.configured({ path: "opencode.db" })),
    offlineModels,
    Watcher.node.replace(Watcher.configured({ enabled: false })),
    Generate.node.replace(
      makeLocationNode({
        service: Generate.Service,
        layer: Layer.succeed(
          Generate.Service,
          Generate.Service.of({
            text: () => Effect.die("unused"),
            image: () => Effect.die("unused"),
            decisions: () => Effect.die("unused"),
            video: {
              start: () => Effect.suspend(() => (state.starts++, state.start)),
              status: () =>
                Effect.suspend(() => {
                  state.reads++
                  if (state.failReads-- > 0) return Effect.fail(providerError("reset"))
                  return state.gate === undefined ? Effect.void : Deferred.await(state.gate)
                }).pipe(Effect.map(() => state.status)),
              result: () => Effect.sync(() => ({ mime: "video/mp4", stream: state.result })),
            },
          }),
        ),
        deps: [],
      }),
    ),
  ])

const settled = (id: GenerationID, step: Duration.Input = "5 seconds") =>
  eventually(
    Generation.Service.pipe(
      Effect.tap(() => TestClock.adjust(step)),
      Effect.flatMap((generations) => generations.get(id)),
    ),
    (job: VideoJob) => job.status !== "running",
  )

const part = (dir: string, id: string) =>
  Effect.promise(() =>
    fs.stat(path.join(dir, "data", "blobs", `${id}.part`)).then(
      () => true,
      () => false,
    ),
  )

const insert = (rows: ReadonlyArray<typeof GenerationTable.$inferInsert>) =>
  Database.Service.pipe(
    Effect.flatMap(({ db }) =>
      db
        .insert(GenerationTable)
        .values([...rows])
        .run(),
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
      expect(yield* db.select().from(GenerationTable).get()).toMatchObject({
        status: "running",
        provider_job_id: "provider_1",
      })
      expect(yield* generations.get(started.id)).toEqual({ id: started.id, status: "running" })

      state.status = { status: "completed" }
      const job = yield* settled(started.id)
      if (job.status !== "completed") throw new Error(`expected completed, got ${JSON.stringify(job)}`)
      const hash = job.media[0]!.slice("media:".length)
      expect(job.expiresAt).toBeGreaterThan((yield* Clock.currentTimeMillis) + 23 * 60 * 60 * 1000)
      const blob = yield* db.select().from(BlobTable).where(eq(BlobTable.hash, hash)).get()
      expect(blob).toMatchObject({ mime: "video/mp4", bytes: 11, expires_at: job.expiresAt })
      expect(blob?.data.byteLength).toBe(0)
      expect(yield* Effect.promise(() => fs.readFile(store.path(hash), "utf8"))).toBe("a small mp4")
      expect(yield* part(dir, started.id)).toBe(false)
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("after a restart, fails a job cut off while submitting and resumes a running one", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-restart-")).path
    const state = provider()
    const submitting = GenerationID.create()
    const running = GenerationID.create()
    // Its first status read fails once, and the server was down past its 2 hour deadline.
    const late = GenerationID.create()
    yield* insert([
      { id: submitting, kind: "video", model, status: "submitting", retention: 60_000 },
      { id: running, kind: "video", model, status: "running", provider_job_id: "provider_9", retention: 60_000 },
      {
        id: late,
        kind: "video",
        model,
        status: "running",
        provider_job_id: "provider_8",
        retention: 60_000,
        time_created: 0,
      },
    ]).pipe(Effect.provide(app(dir, state)))

    yield* TestClock.adjust("3 hours")
    state.status = { status: "completed" }
    state.failReads = 2
    // A slow first read lets time pass while it is in flight, so a deadline would win.
    const gate = yield* Deferred.make<void>()
    state.gate = gate
    yield* Effect.gen(function* () {
      const generations = yield* Generation.Service
      expect(yield* generations.get(submitting)).toMatchObject({ status: "error", reason: "unknown" })
      yield* eventually(
        Effect.sync(() => state.reads),
        (reads) => reads > 0,
      )
      yield* TestClock.adjust("1 second")
      yield* Deferred.succeed(gate, undefined)
      expect(yield* settled(running)).toMatchObject({ status: "completed" })
      expect(yield* settled(late)).toMatchObject({ status: "completed" })
      expect(state.starts).toBe(0)
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("deletes the staged file and reports an error when the download keeps failing", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-fail-")).path
    const state = provider()
    state.result = state.result.pipe(Stream.concat(Stream.fail(providerError("connection reset"))))
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
      expect(yield* part(dir, started.id)).toBe(false)
      expect(yield* db.select().from(BlobTable).all()).toEqual([])
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("reports the provider's failure reason, a job past its deadline and a rejected submission", () =>
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
      expect(yield* settled(slow.id, "30 minutes")).toMatchObject({ status: "error", reason: "unknown" })

      state.start = Effect.fail(providerError("bad", 400))
      const rejected = yield* generations.video({ model, prompt: "a crab" }).pipe(Effect.flip)
      expect(rejected).toMatchObject({ _tag: "Generate.ProviderRequestError", message: "bad" })
    }).pipe(Effect.provide(app(dir, state)))
  }),
)
