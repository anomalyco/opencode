import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Exit, Fiber, Latch, Layer, Stream } from "effect"
import { AttachmentStore } from "@opencode-ai/core/attachment-store"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const first = SessionV2.ID.make("ses_attachment_first")
const second = SessionV2.ID.make("ses_attachment_second")
const bytes = (size: number, value = 1) => new Uint8Array(size).fill(value)
const stat = (target: string) => Effect.promise(() => fs.stat(target))
const readDirectory = (target: string) => Effect.promise(() => fs.readdir(target))
const readBytes = (target: string) => Effect.promise(() => Bun.file(target).bytes())
const attachmentDirectoryName = (name: string) => name.startsWith("att_")
const sequence = (length: number, offset: number) => Array.from({ length }, (_, index) => index + offset)
const infoName = (info: AttachmentStore.Info) => info.name
const contentBytes = (content: Uint8Array) => Array.from(content)

const withStore = <A, E, R>(
  body: Effect.Effect<A, E, R | AttachmentStore.Service | Global.Service>,
  options: Parameters<typeof AttachmentStore.layerWith>[0] = {},
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const global = Global.layerWith({ data: tmp.path })
      const layer = AttachmentStore.layerWith(options).pipe(
        Layer.provide(LayerNode.compile(FSUtil.node)),
        Layer.provide(global),
      )
      return body.pipe(Effect.provide(Layer.merge(layer, global)))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const upload = (store: AttachmentStore.Interface, sessionID: SessionV2.ID, name: string, content: Uint8Array[]) =>
  store.upload({
    sessionID,
    name,
    contentType: "application/example",
    content: Stream.fromIterable(content),
  })

const it = testEffect(Layer.empty)

describe("AttachmentStore", () => {
  it.live("sanitizes hostile filenames and rejects NUL", () =>
    Effect.gen(function* () {
      expect(yield* AttachmentStore.sanitizeName("../../cafe\u0301.txt")).toBe("café.txt")
      expect(yield* AttachmentStore.sanitizeName("photo\u202egnp.exe")).toBe("photognp.exe")
      expect(yield* AttachmentStore.sanitizeName("photo\u061c\u200e\u200f.png")).toBe("photo.png")
      expect(yield* AttachmentStore.sanitizeName("C:\\temp\\CON.txt. ")).toBe("_CON.txt")
      expect(yield* AttachmentStore.sanitizeName("CON .txt")).toBe("_CON .txt")
      expect(yield* AttachmentStore.sanitizeName("con.report.txt")).toBe("_con.report.txt")
      expect(yield* AttachmentStore.sanitizeName("COM¹.txt")).toBe("_COM¹.txt")
      expect(yield* AttachmentStore.sanitizeName("LPT³ .txt")).toBe("_LPT³ .txt")
      expect(yield* AttachmentStore.sanitizeName("../.. ")).toBe("attachment")
      expect(yield* AttachmentStore.sanitizeName("a".repeat(300) + ".txt")).toHaveLength(180)
      expect((yield* AttachmentStore.sanitizeName("bad\0name").pipe(Effect.exit))._tag).toBe("Failure")
    }),
  )

  it.live("writes the first chunk before requesting the rest of a 20 MiB stream", () =>
    withStore(
      Effect.gen(function* () {
        const root = (yield* Global.Service).data
        const store = yield* AttachmentStore.Service
        const requested = yield* Deferred.make<void>()
        const resume = yield* Latch.make()
        function chunk(index: number) {
          const value = bytes(20 * 1024, index % 251)
          if (index === 0) value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          return value
        }
        const content = Stream.concat(
          Stream.make(chunk(0)),
          Stream.concat(
            Stream.fromEffect(
              Deferred.succeed(requested, undefined).pipe(Effect.andThen(resume.await), Effect.as(chunk(1))),
            ),
            Stream.fromIterable(sequence(1022, 2), { chunkSize: 1 }).pipe(Stream.map(chunk)),
          ),
        )
        const fiber = yield* store
          .upload({ sessionID: first, name: "../image.png", contentType: "application/example", content })
          .pipe(Effect.forkChild)
        yield* Deferred.await(requested)
        const session = path.join(root, "attachments", encodeURIComponent(first))
        const directory = (yield* readDirectory(session)).find(attachmentDirectoryName)
        expect(directory).toBeDefined()
        expect((yield* stat(path.join(session, directory!, ".upload"))).size).toBe(20 * 1024)
        yield* resume.open
        const info = yield* Fiber.join(fiber)
        const resolved = yield* store.resolve({ sessionID: first, attachmentID: info.id })
        function readMetadata() {
          return Bun.file(path.join(path.dirname(resolved.path), "metadata.json")).json()
        }
        const metadata = yield* Effect.promise(readMetadata)

        expect(info).toMatchObject({ name: "image.png", mime: "image/png", size: 20 * 1024 * 1024 })
        expect((yield* stat(resolved.path)).size).toBe(20 * 1024 * 1024)
        expect(metadata).toMatchObject({
          originalName: "../image.png",
          storedName: "image.png",
          clientMime: "application/example",
          detectedMime: "image/png",
          size: 20 * 1024 * 1024,
        })
        expect(metadata.sha256).toMatch(/^[0-9a-f]{64}$/)
        if (process.platform !== "win32") {
          expect((yield* stat(path.join(root, "attachments"))).mode & 0o777).toBe(0o700)
          expect((yield* stat(path.dirname(resolved.path))).mode & 0o777).toBe(0o700)
          expect((yield* stat(resolved.path)).mode & 0o777).toBe(0o600)
        }
        expect(resolved.path.startsWith(path.join(root, "attachments", encodeURIComponent(first)))).toBe(true)
      }),
    ),
  )

  it.live("keeps internal metadata names separate from uploaded content", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const inputs = ["metadata.json", ".metadata", ".upload", "METADATA.JSON"]
        function put(name: string, index: number) {
          return upload(store, first, name, [bytes(3, index)])
        }
        const uploaded = yield* Effect.forEach(inputs, put)
        expect(uploaded.map(infoName)).toEqual(["_metadata.json", "_.metadata", "_.upload", "_METADATA.JSON"])
        function read(info: AttachmentStore.Info) {
          function content(resolved: AttachmentStore.Resolved) {
            return readBytes(resolved.path)
          }
          return store.resolve({ sessionID: first, attachmentID: info.id }).pipe(Effect.flatMap(content))
        }
        const contents = yield* Effect.forEach(uploaded, read)
        expect(contents.map(contentBytes)).toEqual([
          [0, 0, 0],
          [1, 1, 1],
          [2, 2, 2],
          [3, 3, 3],
        ])
      }),
    ),
  )

  it.live("refuses a directory symlink swap before final rename", () =>
    withStore(
      Effect.gen(function* () {
        const root = (yield* Global.Service).data
        const store = yield* AttachmentStore.Service
        const outside = path.join(root, "outside")
        const session = path.join(root, "attachments", encodeURIComponent(first))
        async function swap() {
          const entry = (await fs.readdir(session)).find(attachmentDirectoryName)
          if (!entry) throw new Error("attachment directory was not allocated")
          const directory = path.join(session, entry)
          await fs.mkdir(outside)
          await fs.writeFile(path.join(outside, ".upload"), "outside")
          await fs.rename(directory, `${directory}.moved`)
          await fs.symlink(outside, directory, "dir")
          return bytes(1)
        }
        function readOutside() {
          return fs.readFile(path.join(outside, ".upload"), "utf8")
        }
        function listOutside() {
          return fs.readdir(outside)
        }
        const content = Stream.concat(Stream.make(bytes(1)), Stream.fromEffect(Effect.promise(swap)))
        const result = yield* store
          .upload({ sessionID: first, name: "payload.bin", contentType: "application/example", content })
          .pipe(Effect.exit)

        expect(Exit.isFailure(result) && result.cause.toString()).toContain("AttachmentStore.StorageError")
        expect(yield* Effect.promise(readOutside)).toBe("outside")
        expect(yield* Effect.promise(listOutside)).toEqual([".upload"])
      }),
    ),
  )

  it.live("sniffs unknown content as octet-stream", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        expect(yield* upload(store, first, "notes.txt", [bytes(4)])).toMatchObject({
          mime: "application/octet-stream",
        })
      }),
    ),
  )

  it.live("enforces file, session, and global quotas", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const file = yield* upload(store, first, "file.bin", [bytes(11)]).pipe(Effect.exit)
        expect(Exit.isFailure(file) && file.cause.toString()).toContain("AttachmentStore.QuotaError")

        yield* upload(store, first, "first.bin", [bytes(8)])
        const session = yield* upload(store, first, "second.bin", [bytes(5)]).pipe(Effect.exit)
        expect(Exit.isFailure(session) && session.cause.toString()).toContain("AttachmentStore.QuotaError")

        yield* upload(store, second, "global.bin", [bytes(8)])
        const global = yield* upload(store, second, "overflow.bin", [bytes(1)]).pipe(Effect.exit)
        expect(Exit.isFailure(global) && global.cause.toString()).toContain("AttachmentStore.QuotaError")
      }),
      { limits: { file: 10, session: 12, global: 16 } },
    ),
  )

  it.live("serializes concurrent uploads at a session quota boundary", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        function race(name: string) {
          return upload(store, first, name, [bytes(6)]).pipe(Effect.exit)
        }
        const results = yield* Effect.all(["one.bin", "two.bin"].map(race), { concurrency: "unbounded" })
        expect(results.filter(Exit.isSuccess)).toHaveLength(1)
        expect(results.filter(Exit.isFailure)).toHaveLength(1)
      }),
      { limits: { file: 10, session: 10, global: 20 } },
    ),
  )

  it.live("reserves the global quota across concurrent sessions", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const results = yield* Effect.all(
          [
            upload(store, first, "first.bin", [bytes(6)]).pipe(Effect.exit),
            upload(store, second, "second.bin", [bytes(6)]).pipe(Effect.exit),
          ],
          { concurrency: "unbounded" },
        )
        expect(results.filter(Exit.isSuccess)).toHaveLength(1)
        expect(results.filter(Exit.isFailure)).toHaveLength(1)
      }),
      { limits: { file: 10, session: 10, global: 10 } },
    ),
  )

  it.live("rejects cross-session resolution", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const info = yield* upload(store, first, "private.bin", [bytes(1)])
        const result = yield* store.resolve({ sessionID: second, attachmentID: info.id }).pipe(Effect.exit)
        expect(Exit.isFailure(result) && result.cause.toString()).toContain("AttachmentStore.ReferenceError")
      }),
    ),
  )

  it.live("removes expired unbound uploads and preserves bound uploads", () => {
    const clock = { now: 0 }
    return withStore(
      Effect.gen(function* () {
        const root = (yield* Global.Service).data
        const store = yield* AttachmentStore.Service
        const expired = yield* upload(store, first, "expired.bin", [bytes(1)])
        const bound = yield* upload(store, first, "bound.bin", [bytes(1)])
        yield* store.bind({ sessionID: first, attachmentID: bound.id, messageID: SessionMessage.ID.create() })
        clock.now = 25 * 60 * 60 * 1000
        yield* store.cleanup(new Set([first]))

        expect(
          Exit.isFailure(yield* store.resolve({ sessionID: first, attachmentID: expired.id }).pipe(Effect.exit)),
        ).toBe(true)
        expect(yield* store.resolve({ sessionID: first, attachmentID: bound.id })).toMatchObject({ id: bound.id })

        function expireRoot() {
          return fs.utimes(path.join(root, "attachments", encodeURIComponent(first)), new Date(0), new Date(0))
        }
        yield* Effect.promise(expireRoot)
        yield* store.cleanup(new Set())
        expect(
          Exit.isFailure(yield* store.resolve({ sessionID: first, attachmentID: bound.id }).pipe(Effect.exit)),
        ).toBe(true)
      }),
      { now: () => clock.now },
    )
  })
})
