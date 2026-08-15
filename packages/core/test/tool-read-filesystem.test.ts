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

  it.effect("returns the correct page when reading at a high line offset", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "numbered.txt")
      const lines = Array.from({ length: 5_000 }, (_, i) => `line-${i + 1}`)
      yield* files.writeFileString(file, lines.join("\n"))

      const result = yield* ReadToolFileSystem.read(fs, file, "numbered.txt", { offset: 4_000, limit: 3 })

      expect(result).toBeInstanceOf(ReadToolFileSystem.TextPage)
      if (result instanceof ReadToolFileSystem.TextPage) {
        expect(result.offset).toBe(4_000)
        expect(result.content).toBe("line-4000\nline-4001\nline-4002")
        expect(result.truncated).toBe(true)
        expect(result.next).toBe(4_003)
      }
    }),
  )

  it.effect("decodes multibyte UTF-8 correctly when starting after a skip", () =>
    // Guards against the byte-level skip landing mid-codepoint: the position
    // right after a `\n` must be a valid character boundary so the decoder can
    // start fresh on multibyte sequences (ä, γ, 🎉).
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "utf8.txt")
      const lines = ["alpha", "betä", "γgamma", "🎉delta", "epsilon"]
      yield* files.writeFileString(file, lines.join("\n"))

      const result = yield* ReadToolFileSystem.read(fs, file, "utf8.txt", { offset: 3, limit: 2 })

      expect(result).toBeInstanceOf(ReadToolFileSystem.TextPage)
      if (result instanceof ReadToolFileSystem.TextPage) {
        expect(result.content).toBe("γgamma\n🎉delta")
        expect(result.offset).toBe(3)
        expect(result.truncated).toBe(true)
        expect(result.next).toBe(5)
      }
    }),
  )

  it.effect("strips carriage returns from lines read after a skip", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "crlf.txt")
      yield* files.writeFileString(file, "a\r\nb\r\nc\r\nd\r\ne")

      const result = yield* ReadToolFileSystem.read(fs, file, "crlf.txt", { offset: 3, limit: 2 })

      expect(result).toBeInstanceOf(ReadToolFileSystem.TextPage)
      if (result instanceof ReadToolFileSystem.TextPage) {
        expect(result.content).toBe("c\nd")
        expect(result.offset).toBe(3)
      }
    }),
  )

  it.effect("rejects a null byte in the skipped region before the offset", () =>
    // The byte-level skip must still catch binary content (null bytes) in the
    // lines it discards, not just in the lines it returns.
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "binary-skipped.txt")
      yield* files.writeFile(file, new TextEncoder().encode("bad\x00line\ngood\ngood\n"))

      const error = yield* ReadToolFileSystem.read(fs, file, "binary-skipped.txt", { offset: 2 }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
    }),
  )

  it.effect("reads a high offset out of a large file without scanning every line", () =>
    // Regression guard for #35044: reading near the end of a large file must
    // stay fast. The byte-level skip advances past filler lines without
    // decoding them, so reaching the trailing marker stays cheap even with
    // hundreds of thousands of preceding lines spread across many chunks.
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "massive.txt")
      const total = 200_000
      const filler = "filler\n".repeat(total - 1)
      const marker = "MARKER-LINE"
      yield* files.writeFileString(file, filler + marker)

      const startedAt = Date.now()
      const result = yield* ReadToolFileSystem.read(fs, file, "massive.txt", { offset: total })
      const elapsed = Date.now() - startedAt

      expect(result).toBeInstanceOf(ReadToolFileSystem.TextPage)
      if (result instanceof ReadToolFileSystem.TextPage) {
        expect(result.content).toBe(marker)
        expect(result.offset).toBe(total)
        expect(result.truncated).toBe(false)
      }
      // Generous ceiling so this is not flaky on slow CI, while still catching
      // the multi-second regression where every skipped line is decoded.
      expect(elapsed).toBeLessThan(5_000)
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
})
