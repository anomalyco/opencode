import path from "node:path"
import { expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { VideoStatus } from "@opencode/ai/effect"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Generate } from "@opencode/core/generate"
import { BlobStore } from "@opencode/core/blob-store"
import { KV } from "@opencode/core/kv"
import { VideoGeneration } from "@opencode/core/video-generation"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { VideoID, type VideoJob } from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { advance } from "./lib/clock"
import { it } from "./lib/effect"
import { eventually } from "./lib/eventually"

const model = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("video") })

// The start of an MP4: a `ftyp` box, so its type is read from its bytes.
const mp4 = Uint8Array.from([0, 0, 0, 0x14, ...new TextEncoder().encode("ftypmp42"), 0, 0, 0, 0, 1, 2, 3, 4])

/** A provider the test drives: each submission gets the next remote ID, whose status the test sets. */
const provider = () => ({
  submitted: 0,
  status: new Map<string, VideoStatus>(),
  cancelled: [] as string[],
})
type State = ReturnType<typeof provider>

const app = (dir: string, state: State) =>
  AppNodeBuilder.build(
    LayerNode.group([VideoGeneration.node, BlobStore.node, Database.node, KV.node, LocationServiceMap.node]),
    [
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
                start: () => Effect.sync(() => ({ id: `remote_${++state.submitted}` })),
                status: (_, remote) => Effect.sync(() => state.status.get(remote) ?? { status: "running" }),
                result: () =>
                  Effect.succeed([
                    { mime: "video/mp4", stream: Stream.make(mp4) },
                    { mime: "video/mp4", stream: Stream.make(mp4, mp4) },
                  ]),
                cancel: (_, remote) => Effect.sync(() => void state.cancelled.push(remote)),
              },
            }),
          ),
          deps: [],
        }),
      ),
    ],
  )

const settled = (id: VideoID) =>
  eventually(
    VideoGeneration.Service.pipe(
      Effect.tap(() => TestClock.adjust("5 seconds")),
      Effect.flatMap((generations) => generations.get(id)),
    ),
    (job: VideoJob) => job.status !== "running",
  )

const records = KV.Service.pipe(Effect.flatMap((kv) => kv.scan({ prefix: "video:" })))

it.effect("keeps video jobs across restarts and forgets them a day after they finish", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-")).path
    const state = provider()
    const first = yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      const done = yield* generations.start({ model, prompt: "a cat" })
      const slow = yield* generations.start({ model, prompt: "a snail" })
      state.status.set("remote_1", { status: "completed" })
      const job = yield* settled(done.id)
      if (job.status !== "completed") throw new Error(`expected completed, got ${job.status}`)
      expect(job.blobs).toMatchObject([
        { mime: "video/mp4", bytes: mp4.length },
        { mime: "video/mp4", bytes: mp4.length * 2 },
      ])
      expect(job.blobs.every((blob) => blob.id.startsWith("blob_"))).toBe(true)
      expect(yield* generations.get(slow.id)).toEqual({ id: slow.id, status: "running" })
      return { job, slow: slow.id }
    }).pipe(Effect.provide(app(dir, state)))

    yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      expect(yield* generations.get(first.job.id)).toEqual(first.job)
      state.status.set("remote_2", { status: "completed" })
      expect(yield* settled(first.slow)).toMatchObject({ status: "completed" })

      yield* TestClock.adjust("25 hours")
      // A poll already past its clock read when the day passes removes nothing, so keep advancing until one does.
      yield* eventually(
        TestClock.adjust("5 seconds").pipe(Effect.andThen(records)),
        (page) => page.entries.length === 0,
      )
      expect(yield* generations.get(first.job.id).pipe(Effect.flip)).toMatchObject({
        _tag: "VideoGeneration.NotFoundError",
      })
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("waits for a job to finish and cancels a running one", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-")).path
    const state = provider()
    yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      const done = yield* generations.start({ model, prompt: "a cat" })
      const slow = yield* generations.start({ model, prompt: "a snail" })
      const waiting = yield* generations.wait(done.id).pipe(Effect.forkChild({ startImmediately: true }))
      state.status.set("remote_1", { status: "completed" })
      // Advance until the waiter itself is done: it can read "running" and only then sleep, after the job finishes.
      yield* advance(() => waiting.pollUnsafe() !== undefined)
      expect(yield* Fiber.join(waiting)).toMatchObject({ id: done.id, status: "completed", blobs: [{}, {}] })

      yield* generations.cancel(slow.id)
      expect(yield* generations.wait(slow.id)).toMatchObject({ status: "error", reason: "cancelled" })
      expect(state.cancelled).toEqual(["remote_2"])
      expect(yield* generations.wait(VideoID.create()).pipe(Effect.flip)).toMatchObject({
        _tag: "VideoGeneration.NotFoundError",
      })
    }).pipe(Effect.provide(app(dir, state)))
  }),
)
