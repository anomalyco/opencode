import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, FileSystem } from "effect"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, LayerNodePlatform.filesystem])))
const fixture = Effect.gen(function* () {
  const fs = yield* FSUtil.Service
  const files = yield* FileSystem.FileSystem
  const directory = yield* files.makeTempDirectoryScoped()
  return { fs, files, directory }
})

describe("ReadToolFileSystem", () => {
  it.effect("fails with a typed filesystem error when a resolved file disappears", () =>
    Effect.gen(function* () {
      const { fs, directory } = yield* fixture
      const file = path.join(directory, "missing.txt")

      const error = yield* ReadToolFileSystem.read(fs, file, "missing.txt").pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: "PlatformError" })
    }),
  )

  it.effect("fails when a file becomes the wrong path kind", () =>
    Effect.gen(function* () {
      const { fs, directory } = yield* fixture

      const error = yield* ReadToolFileSystem.read(fs, directory, "folder").pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.PathKindError)
    }),
  )

  it.effect("fails with a typed filesystem error when directory listing fails", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "file.txt")
      yield* files.writeFileString(file, "hello")

      const error = yield* ReadToolFileSystem.list(fs, file).pipe(Effect.flip)

      expect(error).toBeInstanceOf(FSUtil.FileSystemError)
      if (error instanceof FSUtil.FileSystemError) expect(error.method).toBe("readDirectoryEntries")
    }),
  )

  it.effect("reads malformed UTF-8 lossily and still rejects null-byte binary content", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const binary = path.join(directory, "archive.dat")
      const malformed = path.join(directory, "malformed.txt")
      yield* files.writeFile(binary, Uint8Array.of(0, 1, 2, 3))
      yield* files.writeFile(malformed, Uint8Array.of(0x68, 0x69, 0x80))

      const binaryError = yield* ReadToolFileSystem.read(fs, binary, "archive.dat").pipe(Effect.flip)
      const malformedResult = yield* ReadToolFileSystem.read(fs, malformed, "malformed.txt")

      expect(binaryError).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
      expect(binaryError.message).toBe("Cannot read binary file: archive.dat")
      expect(malformedResult).toMatchObject({ type: "file", content: "hi\uFFFD", encoding: "utf8" })
    }),
  )

  it.effect("reads text despite a binary-associated extension", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "notes.docx")
      yield* files.writeFileString(file, "plain text")

      const result = yield* ReadToolFileSystem.read(fs, file, "notes.docx")

      expect(result).toMatchObject({ type: "file", content: "plain text", encoding: "utf8" })
    }),
  )

  it.effect("lists unresolved symlinks, including broken and escaping links", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const { fs: service, files, directory } = yield* fixture
      const outside = yield* files.makeTempDirectoryScoped()
      yield* files.makeDirectory(path.join(directory, "folder"))
      yield* files.writeFileString(path.join(directory, "file.txt"), "hello")
      yield* Effect.promise(() => fs.symlink(path.join(outside, "target.txt"), path.join(directory, "escape")))
      yield* Effect.promise(() => fs.symlink(path.join(directory, "missing.txt"), path.join(directory, "broken")))

      const result = yield* ReadToolFileSystem.list(service, directory)

      expect(result.entries.map((entry) => ({ ...entry, path: String(entry.path) }))).toEqual([
        { path: `folder${path.sep}`, type: "directory" },
        { path: "broken", type: "symlink" },
        { path: "escape", type: "symlink" },
        { path: "file.txt", type: "file" },
      ])
    }),
  )

  it.effect("reports out-of-range pagination as a typed error", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "short.txt")
      yield* files.writeFileString(file, "one\n")

      const error = yield* ReadToolFileSystem.read(fs, file, "short.txt", { offset: 2 }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.OffsetOutOfRangeError)
      expect(error.message).toBe("Offset 2 is out of range")
    }),
  )

  it.effect("stops reading after the requested page is complete", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const prefix = new TextEncoder().encode("one\n")
      for (const [name, trailing] of [
        ["malformed.txt", 0x80],
        ["nul.txt", 0],
      ] as const) {
        const file = path.join(directory, name)
        yield* files.writeFile(file, Uint8Array.from([...prefix, trailing]))

        const result = yield* ReadToolFileSystem.read(fs, file, name, { limit: 1 })

        expect(result).toMatchObject({ type: "text-page", content: "one", truncated: true, next: 2 })
      }
    }),
  )

  it.effect("preserves the media ingestion limit message", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "oversized.png")
      yield* files.writeFile(file, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
      yield* files.truncate(file, ReadToolFileSystem.MAX_MEDIA_INGEST_BYTES + 1)

      const error = yield* ReadToolFileSystem.read(fs, file, "oversized.png").pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.MediaIngestLimitError)
      expect(error.message).toBe(
        `Media exceeds ${ReadToolFileSystem.MAX_MEDIA_INGEST_BYTES} byte ingestion limit: oversized.png`,
      )
    }),
  )

  it.effect("reads PDFs as bounded media", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "document.pdf")
      yield* files.writeFileString(file, "%PDF-1.7\ncontent")

      const result = yield* ReadToolFileSystem.read(fs, file, "document.pdf")

      expect(result).toMatchObject({
        type: "file",
        content: Buffer.from("%PDF-1.7\ncontent").toString("base64"),
        encoding: "base64",
        mime: "application/pdf",
      })
    }),
  )
})
