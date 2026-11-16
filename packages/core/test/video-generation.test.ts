import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Clock, type Duration, Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { VideoStatus } from "@opencode/ai/effect"
import { BlobStore } from "@opencode/core/blob-store"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Generate } from "@opencode/core/generate"
import { VideoGeneration } from "@opencode/core/video-generation"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { BlobTable } from "@opencode/core/session/sql"
import type { VideoID, VideoJob } from "@opencode/schema/generate"
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
  status: { status: "running" } as VideoStatus,
  result: Stream.make(new TextEncoder().encode("a small mp4")) as Stream.Stream<Uint8Array, Generate.Error>,
  start: Effect.succeed({ id: "provider_1" }) as Effect.Effect<{ readonly id: string }, Generate.Error>,
  /** Status reads that fail before one succeeds. */
  failReads: 0,
})
type State = ReturnType<typeof provider>

const app = (dir: string, state: State) =>
  AppNodeBuilder.build(LayerNode.group([VideoGeneration.node, BlobStore.node, Database.node, LocationServiceMap.node]), [
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
              start: () => Effect.suspend(() => state.start),
              status: () =>
                Effect.suspend(() =>
                  state.failReads-- > 0 ? Effect.fail(providerError("reset")) : Effect.succeed(state.status),
                ),
              result: () => Effect.sync(() => ({ mime: "video/mp4", stream: state.result })),
            },
          }),
        ),
        deps: [],
      }),
    ),
  ])

const settled = (id: VideoID, step: Duration.Input = "5 seconds") =>
  eventually(
    VideoGeneration.Service.pipe(
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

it.effect("stores a finished video under blobs/ before reporting it completed, past a failed status read", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-")).path
    const state = provider()
    yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      const store = yield* BlobStore.Service
      const { db } = yield* Database.Service
      const started = yield* generations.start({ model, prompt: "a cat" })
      expect(yield* generations.get(started.id)).toEqual({ id: started.id, status: "running" })

      state.status = { status: "completed" }
      state.failReads = 1
      const job = yield* settled(started.id)
      if (job.status !== "completed") throw new Error(`expected completed, got ${JSON.stringify(job)}`)
      const hash = job.media[0]!.slice("media:".length)
      expect(job.expiresAt).toBeGreaterThan((yield* Clock.currentTimeMillis) + 23 * 60 * 60 * 1000)
      const blob = yield* db.select().from(BlobTable).where(eq(BlobTable.hash, hash)).get()
      expect(blob).toMatchObject({ mime: "video/mp4", bytes: 11, expires_at: job.expiresAt })
      expect(blob?.data.byteLength).toBe(0)
      expect(yield* Effect.promise(() => fs.readFile(store.path(hash), "utf8"))).toBe("a small mp4")
      expect(yield* part(dir, started.id)).toBe(false)

      // Forgotten with its video.
      yield* TestClock.adjust("24 hours")
      expect(yield* generations.get(started.id).pipe(Effect.flip)).toMatchObject({
        _tag: "VideoGeneration.NotFoundError",
      })
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("deletes the staged file and reports an error when the download keeps failing", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-fail-")).path
    const state = provider()
    state.result = state.result.pipe(Stream.concat(Stream.fail(providerError("connection reset"))))
    yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      const { db } = yield* Database.Service
      const started = yield* generations.start({ model, prompt: "a bird" })
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
      const generations = yield* VideoGeneration.Service
      const expired = yield* generations.start({ model, prompt: "a fish" })
      state.status = { status: "error", reason: "expired" }
      expect(yield* settled(expired.id)).toMatchObject({ status: "error", reason: "expired" })

      state.status = { status: "running" }
      const slow = yield* generations.start({ model, prompt: "a snail" })
      expect(yield* settled(slow.id, "30 minutes")).toMatchObject({ status: "error", reason: "unknown" })

      state.start = Effect.fail(providerError("bad", 400))
      const rejected = yield* generations.start({ model, prompt: "a crab" }).pipe(Effect.flip)
      expect(rejected).toMatchObject({ _tag: "Generate.ProviderRequestError", message: "bad" })
    }).pipe(Effect.provide(app(dir, state)))
  }),
)
