import path from "node:path"
import { expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Generate } from "@opencode/core/generate"
import { BlobStore } from "@opencode/core/blob-store"
import { ImageGeneration } from "@opencode/core/image-generation"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { ImageID } from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { eventually } from "./lib/eventually"

const model = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("painter") })
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const app = (dir: string, release: Deferred.Deferred<void>) =>
  AppNodeBuilder.build(
    LayerNode.group([ImageGeneration.node, BlobStore.node, Database.node, KV.node, LocationServiceMap.node]),
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
              // Each request waits until the test releases it; a crab never finishes.
              image: (input) =>
                input.prompt === "a crab"
                  ? Effect.never
                  : Deferred.await(release).pipe(
                      Effect.as({ images: [{ type: "image" as const, data: PNG, mime: "image/png" }] }),
                    ),
              checkImage: () => Effect.void,
              decisions: () => Effect.die("unused"),
              video: {
                start: () => Effect.die("unused"),
                status: () => Effect.die("unused"),
                result: () => Effect.die("unused"),
                cancel: () => Effect.die("unused"),
              },
            }),
          ),
          deps: [],
        }),
      ),
    ],
  )

const settled = (id: ImageID) =>
  eventually(
    ImageGeneration.Service.pipe(
      Effect.tap(() => TestClock.adjust("5 seconds")),
      Effect.flatMap((images) => images.get(id)),
    ),
    (job) => job.status !== "running",
  )

it.effect("runs a job in the background, cancels one, and fails one whose server stopped", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-image-generation-")).path
    const release = yield* Deferred.make<void>()
    const stuck = yield* Effect.gen(function* () {
      const images = yield* ImageGeneration.Service
      const done = yield* images.start({ model, prompt: "a cat" })
      const cancelled = yield* images.start({ model, prompt: "a dog" })
      const stuck = yield* images.start({ model, prompt: "a crab" })
      expect(yield* images.get(done.id)).toEqual({ id: done.id, status: "running" })

      yield* images.cancel(cancelled.id)
      expect(yield* images.wait(cancelled.id)).toMatchObject({ status: "error", reason: "cancelled" })

      yield* Deferred.succeed(release, undefined)
      expect(yield* settled(done.id)).toMatchObject({
        status: "completed",
        blobs: [{ mime: "image/png", bytes: Buffer.from(PNG, "base64").length }],
      })
      return stuck.id
    }).pipe(Effect.provide(app(dir, release)))

    // The server making the crab's request stopped, so its record stays running until the deadline.
    yield* Effect.gen(function* () {
      const images = yield* ImageGeneration.Service
      expect(yield* images.get(stuck)).toEqual({ id: stuck, status: "running" })
      yield* TestClock.adjust("31 minutes")
      expect(yield* settled(stuck)).toMatchObject({ status: "error", reason: "unknown" })
      expect(yield* images.get(ImageID.create()).pipe(Effect.flip)).toMatchObject({
        _tag: "ImageGeneration.NotFoundError",
      })
    }).pipe(Effect.provide(app(dir, release)))
  }),
)
