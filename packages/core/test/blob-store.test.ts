import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Duration, Effect, Exit, Stream } from "effect"
import { BlobStore } from "@opencode/core/blob-store"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { eventually } from "./lib/eventually"

const app = (dir: string) =>
  AppNodeBuilder.build(LayerNode.group([BlobStore.node]), [
    Global.node.replace(Global.layerWith({ data: path.join(dir, "data"), config: path.join(dir, "config") })),
  ])

it.effect("deletes blobs a week after they were written", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-blob-store-")).path
    const ids = yield* Effect.gen(function* () {
      const blobs = yield* BlobStore.Service
      const old = yield* blobs.write(Stream.make(Uint8Array.of(1, 2, 3)))
      const fresh = yield* blobs.write(Stream.make(Uint8Array.of(4, 5, 6)))
      const week = new Date(Date.now() - Duration.toMillis(BlobStore.RETENTION) - 1000)
      yield* Effect.promise(() => fs.utimes(path.join(dir, "data", BlobStore.DIRECTORY, old.id), week, week))
      return { old: old.id, fresh: fresh.id }
    }).pipe(Effect.provide(app(dir)))

    // The next server to start runs the cleanup.
    yield* Effect.gen(function* () {
      const blobs = yield* BlobStore.Service
      yield* eventually(Effect.exit(blobs.read(ids.old)), Exit.isFailure)
      expect(yield* blobs.read(ids.fresh)).toMatchObject({ id: ids.fresh, bytes: 3 })
    }).pipe(Effect.provide(app(dir)))
  }),
)
