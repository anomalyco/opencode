import { describe, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { testEffect } from "./lib/effect"

const it = testEffect(FSUtil.layer.pipe(Layer.provideMerge(NodeFileSystem.layer)))

describe("ReadToolFileSystem", () => {
  it.effect("fails with a typed filesystem error when a resolved file disappears", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileSystem.FileSystem
      const directory = yield* files.makeTempDirectoryScoped()
      const file = path.join(directory, "missing.txt")

      const error = yield* ReadToolFileSystem.read(fs, file, "missing.txt").pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: "PlatformError" })
    }),
  )

  it.effect("fails when a file becomes the wrong path kind", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileSystem.FileSystem
      const directory = yield* files.makeTempDirectoryScoped()

      const error = yield* ReadToolFileSystem.read(fs, directory, "folder").pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.PathKindError)
    }),
  )

  it.effect("fails with a typed filesystem error when directory listing fails", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileSystem.FileSystem
      const directory = yield* files.makeTempDirectoryScoped()
      const file = path.join(directory, "file.txt")
      yield* files.writeFileString(file, "hello")

      const error = yield* ReadToolFileSystem.list(fs, file).pipe(Effect.flip)

      expect(error).toBeInstanceOf(FSUtil.FileSystemError)
      if (error instanceof FSUtil.FileSystemError) expect(error.method).toBe("readDirectoryEntries")
    }),
  )

  it.effect("reports binary and malformed UTF-8 content as typed errors", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileSystem.FileSystem
      const directory = yield* files.makeTempDirectoryScoped()
      const binary = path.join(directory, "archive.dat")
      const malformed = path.join(directory, "malformed.txt")
      yield* files.writeFile(binary, Uint8Array.of(0, 1, 2, 3))
      yield* files.writeFile(malformed, Uint8Array.of(0xc3, 0x28))

      const binaryError = yield* ReadToolFileSystem.read(fs, binary, "archive.dat").pipe(Effect.flip)
      const malformedError = yield* ReadToolFileSystem.read(fs, malformed, "malformed.txt").pipe(Effect.flip)

      expect(binaryError).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
      expect(binaryError.message).toBe("Cannot read binary file: archive.dat")
      expect(malformedError).toBeInstanceOf(ReadToolFileSystem.MalformedUtf8Error)
    }),
  )

  it.effect("reports out-of-range pagination as a typed error", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileSystem.FileSystem
      const directory = yield* files.makeTempDirectoryScoped()
      const file = path.join(directory, "short.txt")
      yield* files.writeFileString(file, "one\n")

      const error = yield* ReadToolFileSystem.read(fs, file, "short.txt", { offset: 2 }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.OffsetOutOfRangeError)
      expect(error.message).toBe("Offset 2 is out of range")
    }),
  )

  it.effect("preserves the media ingestion limit message", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileSystem.FileSystem
      const directory = yield* files.makeTempDirectoryScoped()
      const file = path.join(directory, "oversized.png")
      const content = new Uint8Array(ReadToolFileSystem.MAX_MEDIA_INGEST_BYTES + 1)
      content.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      yield* files.writeFile(file, content)

      const error = yield* ReadToolFileSystem.read(fs, file, "oversized.png").pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.MediaIngestLimitError)
      expect(error.message).toBe(
        `Media exceeds ${ReadToolFileSystem.MAX_MEDIA_INGEST_BYTES} byte ingestion limit: oversized.png`,
      )
    }),
  )
})
