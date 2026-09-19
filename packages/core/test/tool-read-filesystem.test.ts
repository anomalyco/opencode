import { describe, expect } from "bun:test"
import path from "path"
import { Effect, FileSystem } from "effect"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
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

  it.effect("reports binary and malformed UTF-8 content as typed errors", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const binary = path.join(directory, "archive.dat")
      const malformed = path.join(directory, "malformed.txt")
      yield* files.writeFile(binary, Uint8Array.of(0, 1, 2, 3))
      const malformedContent = new Uint8Array(64 * 1024 + 1).fill(97)
      malformedContent[64 * 1024] = 0x80
      yield* files.writeFile(malformed, malformedContent)

      const binaryError = yield* ReadToolFileSystem.read(fs, binary, "archive.dat").pipe(Effect.flip)
      const malformedError = yield* ReadToolFileSystem.read(fs, malformed, "malformed.txt").pipe(Effect.flip)

      expect(binaryError).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
      expect(binaryError.message).toBe("Cannot read binary file: archive.dat")
      expect(malformedError).toBeInstanceOf(ReadToolFileSystem.MalformedUtf8Error)
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

  Array.of(
    { name: "a surrogate pair at the truncation boundary", text: "a".repeat(1999) + "😀tail", head: "a".repeat(1999) },
    {
      name: "a complete surrogate pair within the limit",
      text: "a".repeat(1998) + "😀tail",
      head: "a".repeat(1998) + "😀",
    },
    { name: "ASCII at the truncation boundary", text: "a".repeat(2000) + "tail", head: "a".repeat(2000) },
    { name: "BMP Unicode at the truncation boundary", text: "文".repeat(2000) + "tail", head: "文".repeat(2000) },
  ).forEach((input) => {
    it.live(`preserves valid Unicode when truncating ${input.name}`, () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const file = path.join(test.directory, "unicode.txt")
        yield* test.files.writeFileString(file, input.text + "\nnext")

        const result = yield* ReadToolFileSystem.read(test.fs, file, "unicode.txt", { limit: 1 })

        expect(result).toMatchObject({
          type: "text-page",
          content: input.head + "... (line truncated to 2000 chars)",
          truncated: true,
          next: 2,
        })
        expect(result.content.isWellFormed()).toBe(true)
        expect(Buffer.from(result.content).toString()).toBe(result.content)
      }),
    )
  })

  it.live("keeps exact-limit Unicode lines without a truncation marker", () =>
    Effect.gen(function* () {
      const test = yield* fixture
      const file = path.join(test.directory, "exact.txt")
      const content = "a".repeat(1998) + "😀"
      yield* test.files.writeFileString(file, content + "\r\nnext")

      const result = yield* ReadToolFileSystem.read(test.fs, file, "exact.txt", { limit: 1 })

      expect(result).toMatchObject({ type: "text-page", content, truncated: true, next: 2 })
      expect(result.content.isWellFormed()).toBe(true)
    }),
  )

  it.live("preserves Unicode when a truncated line spans read chunks and ends at EOF", () =>
    Effect.gen(function* () {
      const test = yield* fixture
      const file = path.join(test.directory, "chunks.txt")
      // The first two bytes of the emoji fall in the first 64 KiB read.
      yield* test.files.writeFileString(file, "p".repeat(63_534) + "\n" + "a".repeat(1999) + "😀tail")

      const result = yield* ReadToolFileSystem.read(test.fs, file, "chunks.txt", { offset: 2, limit: 1 })

      expect(result).toMatchObject({
        type: "text-page",
        content: "a".repeat(1999) + "... (line truncated to 2000 chars)",
        offset: 2,
        truncated: false,
      })
      expect(result.content.isWellFormed()).toBe(true)
    }),
  )
})
