import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Exit, Stream } from "effect"
import { BlobStore } from "@opencode/core/blob-store"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionSchema } from "@opencode/core/session/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const app = (dir: string) =>
  AppNodeBuilder.build(LayerNode.group([BlobStore.node]), [
    Global.node.replace(Global.layerWith({ data: path.join(dir, "data"), config: path.join(dir, "config") })),
  ])

// A PNG signature and IHDR, 3 by 2 pixels: enough for the type and the size.
const png = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2,
)
const text = (stream: Stream.Stream<Uint8Array>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((chunks) => Buffer.concat([...chunks])),
  )

it.effect("keeps small blobs in SQLite and large ones on disk, with what their bytes say", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-blob-store-")).path
    yield* Effect.gen(function* () {
      const blobs = yield* BlobStore.Service
      const sessionID = SessionSchema.ID.create()
      const image = yield* blobs.write(Stream.make(png), { sessionID, name: "dot.png", mime: "text/plain" })
      expect(image).toMatchObject({ sessionID, name: "dot.png", mime: "image/png", bytes: 24, width: 3, height: 2 })

      const large = new Uint8Array(BlobStore.INLINE + 10).fill(7)
      const big = yield* blobs.write(Stream.make(large.subarray(0, 1000), large.subarray(1000)), { mime: "text/plain" })
      expect(big).toMatchObject({ mime: "text/plain", bytes: large.length })
      const files = yield* Effect.promise(() => fs.readdir(path.join(dir, "data", BlobStore.DIRECTORY)))
      expect(files).toEqual([big.id])

      expect(yield* text(yield* blobs.content(image.id, { offset: 8, length: 4 }))).toEqual(Buffer.from(png.subarray(8, 12)))
      expect((yield* text(yield* blobs.content(big.id))).equals(Buffer.from(large))).toBe(true)

      expect((yield* blobs.list({ sessionID })).map((blob) => blob.id)).toEqual([image.id])
      expect((yield* blobs.list()).map((blob) => blob.id)).toEqual([big.id, image.id])

      const updated = yield* blobs.update(image.id, { metadata: { starred: true } })
      expect(updated).toMatchObject({ name: "dot.png", metadata: { starred: true }, width: 3 })

      yield* blobs.remove(big.id)
      expect(Exit.isFailure(yield* Effect.exit(blobs.get(big.id)))).toBe(true)
      expect(yield* Effect.promise(() => fs.readdir(path.join(dir, "data", BlobStore.DIRECTORY)))).toEqual([])
    }).pipe(Effect.provide(app(dir)))
  }),
)

it.effect("a failed write leaves no blob", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-blob-store-")).path
    yield* Effect.gen(function* () {
      const blobs = yield* BlobStore.Service
      const stream = Stream.make(new Uint8Array(BlobStore.INLINE + 1)).pipe(Stream.concat(Stream.fail("broken")))
      expect(Exit.isFailure(yield* Effect.exit(blobs.write(stream)))).toBe(true)
      expect(yield* blobs.list()).toEqual([])
      expect(yield* Effect.promise(() => fs.readdir(path.join(dir, "data", BlobStore.DIRECTORY)))).toEqual([])
    }).pipe(Effect.provide(app(dir)))
  }),
)
