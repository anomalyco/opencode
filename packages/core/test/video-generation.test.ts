import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { type Duration, Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { VideoStatus } from "@opencode/ai/effect"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Generate } from "@opencode/core/generate"
import { VideoGeneration } from "@opencode/core/video-generation"
import { LocationServiceMap } from "@opencode/core/location-service-map"
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

// The start of an MP4: a `ftyp` box, so its type is read from its bytes.
const mp4 = Uint8Array.from([0, 0, 0, 0x14, ...new TextEncoder().encode("ftypmp42"), 0, 0, 0, 0, 1, 2, 3, 4])

/** A provider the test drives. */
const provider = () => ({
  status: { status: "running" } as VideoStatus,
  result: Stream.make(mp4) as Stream.Stream<Uint8Array, Generate.Error>,
  start: Effect.succeed({ id: "provider_1" }) as Effect.Effect<{ readonly id: string }, Generate.Error>,
  /** Status reads that fail before one succeeds. */
  failReads: 0,
})
type State = ReturnType<typeof provider>

const app = (dir: string, state: State) =>
  AppNodeBuilder.build(LayerNode.group([VideoGeneration.node, Database.node, LocationServiceMap.node]), [
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

const exists = (file: string) =>
  Effect.promise(() =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  )
const object = (dir: string, id: string) => path.join(dir, "data", "objects", id)

it.effect("stores a finished video under objects/, reads it after a restart and deletes it after 7 days", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-")).path
    const state = provider()
    const id = yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      const started = yield* generations.start({ model, prompt: "a cat" })
      expect(yield* generations.get(started.id)).toEqual({ id: started.id, status: "running" })

      state.status = { status: "completed" }
      // A failed status read is retried at the next interval.
      state.failReads = 1
      const job = yield* settled(started.id)
      expect(job).toMatchObject({ id: started.id, status: "completed", mime: "video/mp4", bytes: mp4.length })
      if (job.status === "completed") expect(job.expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
      expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(object(dir, started.id))))).toEqual(mp4)
      expect(yield* exists(`${object(dir, started.id)}.part`)).toBe(false)
      return started.id
    }).pipe(Effect.provide(app(dir, state)))

    yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      // A new process knows nothing of the job, but the object is the record.
      expect(yield* generations.get(id)).toMatchObject({ status: "completed", mime: "video/mp4" })
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      yield* Effect.promise(() => fs.utimes(object(dir, id), old, old))
      yield* TestClock.adjust("1 hour")
      yield* eventually(exists(object(dir, id)), (found) => !found)
      expect(yield* generations.get(id).pipe(Effect.flip)).toMatchObject({ _tag: "VideoGeneration.NotFoundError" })
    }).pipe(Effect.provide(app(dir, state)))
  }),
)

it.effect("deletes the partial file and reports an error when the download keeps failing", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-generation-fail-")).path
    const state = provider()
    state.result = state.result.pipe(Stream.concat(Stream.fail(providerError("connection reset"))))
    yield* Effect.gen(function* () {
      const generations = yield* VideoGeneration.Service
      const started = yield* generations.start({ model, prompt: "a bird" })
      state.status = { status: "completed" }
      expect(yield* settled(started.id, "1 second")).toEqual({
        id: started.id,
        status: "error",
        reason: "failed",
        error: "connection reset",
      })
      expect(yield* exists(`${object(dir, started.id)}.part`)).toBe(false)
      expect(yield* exists(object(dir, started.id))).toBe(false)
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
