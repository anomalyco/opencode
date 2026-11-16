import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect, Stream } from "effect"
import { TestClock } from "effect/testing"
import { BlobStore } from "@opencode/core/blob-store"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionBlob } from "@opencode/core/session/blob"
import { BlobRefTable, BlobTable, SessionMessageTable } from "@opencode/core/session/sql"
import { SessionStored } from "@opencode/core/session/stored"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([BlobStore.node, Database.node, Global.node]), [
    Global.node.replace(tempGlobalLayer),
  ]),
)

const HOUR = 60 * 60 * 1000

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const store = yield* BlobStore.Service
  // Refs here name no real session; the retention rules don't depend on one.
  yield* db.run(sql`PRAGMA foreign_keys = OFF`)
  yield* TestClock.setTime(10 * HOUR)
  return { db, store }
})

// A file blob as a generation stores it: bytes in `blobs/`, an empty `data` and the real size.
const fileBlob = Effect.fnUntraced(function* (id: string, bytes: Uint8Array, expires: number | null) {
  const { db } = yield* Database.Service
  const store = yield* BlobStore.Service
  const staged = yield* store.stage(id, Stream.make(bytes))
  yield* store.commit(
    id,
    staged,
    SessionBlob.save(db, [
      { hash: staged.hash, mime: "video/mp4", bytes: staged.bytes, data: Buffer.alloc(0), expires_at: expires },
    ]),
  )
  return staged.hash
})

const inlineBlob = (hash: string, expires: number | null) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* SessionBlob.save(db, [{ hash, mime: "image/png", bytes: 3, data: Buffer.from("png"), expires_at: expires }])
  })

const ref = (hash: string, messageID = "msg_1") =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(BlobRefTable)
      .values({ session_id: "ses_1" as never, message_id: messageID as never, hash, seq: 1 })
      .run()
  })

const hashes = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return (yield* db.select({ hash: BlobTable.hash }).from(BlobTable).all()).map((row) => row.hash).sort()
})

const exists = (file: string) =>
  Effect.promise(() =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  )

it.effect("sweeps only expired, unreferenced blobs, deleting the row before the file", () =>
  Effect.gen(function* () {
    const { store } = yield* setup
    const now = 10 * HOUR
    const expired = yield* fileBlob("gen_expired", new TextEncoder().encode("expired video"), now - 1)
    const pinned = yield* fileBlob("gen_pinned", new TextEncoder().encode("pinned video"), now - 1)
    const fresh = yield* fileBlob("gen_fresh", new TextEncoder().encode("fresh video"), now + HOUR)
    const orphan = yield* fileBlob("gen_orphan", new TextEncoder().encode("orphan video"), null)
    yield* ref(pinned)
    yield* inlineBlob("a".repeat(64), now - 1)
    yield* inlineBlob("b".repeat(64), null)

    yield* store.sweep

    expect(yield* hashes).toEqual([pinned, fresh, "b".repeat(64)].sort())
    expect(yield* exists(store.path(expired))).toBe(false)
    expect(yield* exists(store.path(orphan))).toBe(false)
    expect(yield* exists(store.path(pinned))).toBe(true)
    expect(yield* exists(store.path(fresh))).toBe(true)

    // Once its expiry passes, the fresh one goes too; the pinned one stays while its ref does.
    yield* TestClock.adjust(2 * HOUR)
    yield* store.sweep
    expect(yield* hashes).toEqual([pinned, "b".repeat(64)].sort())
    expect(yield* exists(store.path(fresh))).toBe(false)
  }),
)

it.effect("keeps an unreferenced blob readable until it expires, and release never deletes a file blob", () =>
  Effect.gen(function* () {
    const { db } = yield* setup
    const now = 10 * HOUR
    const video = yield* fileBlob("gen_video", new TextEncoder().encode("video"), now + HOUR)
    const image = "c".repeat(64)
    yield* inlineBlob(image, now + HOUR)
    yield* ref(video)
    yield* ref(image)

    expect(yield* SessionBlob.read(db, video)).toEqual({ mime: "video/mp4", bytes: 5, data: undefined })
    expect((yield* SessionBlob.read(db, image))?.data?.toString()).toBe("png")

    // Releasing the refs before the expiry keeps both.
    yield* SessionBlob.releaseMessage(db, "ses_1" as never, "msg_1" as never)
    expect(yield* hashes).toEqual([image, video].sort())
    expect(yield* SessionBlob.read(db, image)).toBeDefined()

    // After it, the blobs read as missing, and release would drop the inline one but leave the file blob to the sweep.
    yield* TestClock.adjust(2 * HOUR)
    expect(yield* SessionBlob.read(db, video)).toBeUndefined()
    yield* ref(video, "msg_2")
    yield* ref(image, "msg_2")
    yield* SessionBlob.releaseMessage(db, "ses_1" as never, "msg_2" as never)
    expect(yield* hashes).toEqual([video])
  }),
)

it.effect("saving a hash again keeps the later expiry", () =>
  Effect.gen(function* () {
    const { db } = yield* setup
    const hash = "d".repeat(64)
    const expiry = () =>
      db
        .select({ expires: BlobTable.expires_at })
        .from(BlobTable)
        .get()
        .pipe(Effect.map((row) => row?.expires))
    yield* inlineBlob(hash, 100)
    yield* inlineBlob(hash, 300)
    expect(yield* expiry()).toBe(300)
    yield* inlineBlob(hash, 200)
    expect(yield* expiry()).toBe(300)
    // Session media has no expiry and never shortens one.
    yield* inlineBlob(hash, null)
    expect(yield* expiry()).toBe(300)
  }),
)

it.effect("history never loads a file blob's bytes", () =>
  Effect.gen(function* () {
    const { db } = yield* setup
    const hash = yield* fileBlob("gen_history", new TextEncoder().encode("a long video"), null)
    const row = {
      id: "msg_1",
      session_id: "ses_1",
      type: "user",
      seq: 1,
      time_created: 1,
      time_updated: 1,
      data: {
        text: "watch",
        files: [{ uri: SessionStored.ref(hash), mime: "video/mp4", name: "clip.mp4", source: { type: "inline" } }],
        time: { created: 1 },
      },
    } as unknown as typeof SessionMessageTable.$inferSelect
    const [hydrated] = yield* SessionBlob.hydrate(db, [row])
    expect(hydrated?.data).toMatchObject({
      files: [
        {
          mime: "text/plain",
          name: "clip.mp4",
          data: Buffer.from("[media unavailable: clip.mp4 (video/mp4)]").toString("base64"),
        },
      ],
    })
  }),
)

it.effect("commit reuses an intact copy of the same bytes and drops the staged file", () =>
  Effect.gen(function* () {
    const { store } = yield* setup
    const global = yield* Global.Service
    const first = yield* fileBlob("gen_first", new TextEncoder().encode("same bytes"), null)
    const staged = yield* store.stage("gen_second", Stream.make(new TextEncoder().encode("same bytes")))
    expect(staged.hash).toBe(first)
    yield* store.commit("gen_second", staged, Effect.void)
    expect(yield* exists(path.join(global.data, "blobs", "gen_second.part"))).toBe(false)
    expect(yield* Effect.promise(() => fs.readFile(store.path(first), "utf8"))).toBe("same bytes")
  }),
)
