import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Environment } from "@opencode/core/environment/index"
import { AbsolutePath } from "@opencode/core/schema"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, FileSystem } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem])))
const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const directory = yield* files.makeTempDirectoryScoped()
  return { environment: Environment.makeFiles(Environment.makeLocalDriver(spawner)), files, directory }
})
const absolute = (value: string) => AbsolutePath.make(value)

describe("ReadTool text serialization", () => {
  const cases = [
    {
      name: "preserves a selected trailing blank line before continuation",
      content: "alpha\n\nomega\n",
      page: { offset: 1, limit: 2 },
      output: { type: "text-page", content: "alpha\n", offset: 1, truncated: true, next: 3 },
      model: "Read file lines.txt, lines 1-2\n1: alpha\n2: \n[Output truncated. Continue reading with offset: 3]",
    },
    {
      name: "preserves multiple selected trailing blank lines at a noninitial offset",
      content: "before\nalpha\n\n\nomega\n",
      page: { offset: 2, limit: 3 },
      output: { type: "text-page", content: "alpha\n\n", offset: 2, truncated: true, next: 5 },
      model: "Read file lines.txt, lines 2-4\n2: alpha\n3: \n4: \n[Output truncated. Continue reading with offset: 5]",
    },
    {
      name: "preserves a selected trailing blank line at EOF",
      content: "alpha\n\n",
      page: { limit: 2 },
      output: { type: "text-page", content: "alpha\n", offset: 1, truncated: false },
      model: "Read file lines.txt, lines 1-2\n1: alpha\n2: ",
    },
    {
      name: "preserves internal blank lines in a page",
      content: "alpha\n\nomega\n",
      page: { limit: 3 },
      output: { type: "text-page", content: "alpha\n\nomega", offset: 1, truncated: false },
      model: "Read file lines.txt, lines 1-3\n1: alpha\n2: \n3: omega",
    },
    {
      name: "preserves continuation for a nonblank page",
      content: "alpha\n\nomega\n",
      page: { limit: 1 },
      output: { type: "text-page", content: "alpha", offset: 1, truncated: true, next: 2 },
      model: "Read file lines.txt, lines 1-1\n1: alpha\n[Output truncated. Continue reading with offset: 2]",
    },
    {
      name: "strips only the terminal file newline in a whole-file read",
      content: "alpha\n\n",
      page: {},
      output: { type: "file", content: "alpha\n\n", encoding: "utf8" },
      model: "Read file lines.txt, lines 1-2\n1: alpha\n2: ",
    },
    {
      name: "does not add a line for a whole-file terminal newline",
      content: "alpha\n",
      page: {},
      output: { type: "file", content: "alpha\n", encoding: "utf8" },
      model: "Read file lines.txt, lines 1-1\n1: alpha",
    },
    {
      name: "preserves a whole-file read without a terminal newline",
      content: "alpha",
      page: {},
      output: { type: "file", content: "alpha", encoding: "utf8" },
      model: "Read file lines.txt, lines 1-1\n1: alpha",
    },
    {
      name: "preserves empty whole-file output",
      content: "",
      page: {},
      output: { type: "file", content: "", encoding: "utf8" },
      model: "Read file lines.txt, 0 lines",
    },
    {
      name: "preserves empty-file page output",
      content: "",
      page: { limit: 2 },
      output: { type: "text-page", content: "", offset: 1, truncated: false },
      model: "Read file lines.txt, 0 lines",
    },
  ]

  cases.forEach((input) => {
    it.live(input.name, () =>
      Effect.gen(function* () {
        const current = yield* fixture
        const file = absolute(path.join(current.directory, "lines.txt"))
        yield* current.files.writeFileString(file, input.content)

        const result = yield* ReadToolFileSystem.read(current.environment, file, "lines.txt", input.page)

        expect(result).toMatchObject(input.output)
        expect(ReadTool.toModelContent("lines.txt", undefined, result)).toBe(input.model)
      }),
    )
  })
})

describe("ReadToolFileSystem", () => {
  it.effect("preserves the environment not-found error", () =>
    Effect.gen(function* () {
      const { environment, directory } = yield* fixture
      const file = path.join(directory, "missing.txt")

      const error = yield* ReadToolFileSystem.read(environment, absolute(file), "missing.txt").pipe(Effect.flip)

      expect(error).toBeInstanceOf(Environment.NotFound)
    }),
  )

  it.effect("returns a listing when read reports a directory", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      yield* files.makeDirectory(path.join(directory, "folder"))
      yield* files.writeFileString(path.join(directory, "file.txt"), "hello")

      const result = yield* ReadToolFileSystem.read(environment, absolute(directory), "folder")

      expect(result).toMatchObject({
        type: "list-page",
        entries: [
          { path: `folder${path.sep}`, type: "directory" },
          { path: "file.txt", type: "file" },
        ],
      })
    }),
  )

  it.effect("reads malformed UTF-8 lossily and still rejects null-byte binary content", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const binary = path.join(directory, "archive.dat")
      const malformed = path.join(directory, "malformed.txt")
      yield* files.writeFile(binary, Uint8Array.of(0, 1, 2, 3))
      yield* files.writeFile(malformed, Uint8Array.of(0x68, 0x69, 0x80))

      const binaryError = yield* ReadToolFileSystem.read(environment, absolute(binary), "archive.dat").pipe(Effect.flip)
      const malformedResult = yield* ReadToolFileSystem.read(environment, absolute(malformed), "malformed.txt")

      expect(binaryError).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
      expect(binaryError.message).toBe("Cannot read binary file: archive.dat")
      expect(malformedResult).toMatchObject({ type: "file", content: "hi\uFFFD", encoding: "utf8" })
    }),
  )

  it.effect("reads text despite a binary-associated extension", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "notes.docx")
      yield* files.writeFileString(file, "plain text")

      const result = yield* ReadToolFileSystem.read(environment, absolute(file), "notes.docx")

      expect(result).toMatchObject({ type: "file", content: "plain text", encoding: "utf8" })
    }),
  )

  it.effect("lists unresolved symlinks, including broken and escaping links", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const { environment, files, directory } = yield* fixture
      const outside = yield* files.makeTempDirectoryScoped()
      yield* files.makeDirectory(path.join(directory, "folder"))
      yield* files.writeFileString(path.join(directory, "file.txt"), "hello")
      yield* Effect.promise(() => fs.symlink(path.join(outside, "target.txt"), path.join(directory, "escape")))
      yield* Effect.promise(() => fs.symlink(path.join(directory, "missing.txt"), path.join(directory, "broken")))

      const result = yield* ReadToolFileSystem.read(environment, absolute(directory), "folder")

      expect(result.type).toBe("list-page")
      if (result.type !== "list-page") return
      expect(result.entries.map((entry) => ({ ...entry, path: String(entry.path) }))).toEqual([
        { path: `folder${path.sep}`, type: "directory" },
        { path: "broken", type: "symlink" },
        { path: "escape", type: "symlink" },
        { path: "file.txt", type: "file" },
      ])
    }),
  )

  it.effect("reads a symlinked directory as a listing", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const { environment, files, directory } = yield* fixture
      const target = path.join(directory, "target")
      const link = path.join(directory, "link")
      yield* files.makeDirectory(target)
      yield* files.writeFileString(path.join(target, "file.txt"), "hello")
      yield* Effect.promise(() => fs.symlink(target, link))

      const result = yield* ReadToolFileSystem.read(environment, absolute(link), "link")

      expect(result).toMatchObject({
        type: "list-page",
        entries: [{ path: "file.txt", type: "file" }],
      })
    }),
  )

  it.effect("returns the last lines when the offset is past the end", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const read = (name: string, content: string, page: ReadToolFileSystem.PageInput) =>
        files.writeFileString(path.join(directory, name), content).pipe(
          Effect.andThen(ReadToolFileSystem.read(environment, absolute(path.join(directory, name)), name, page)),
          Effect.map((result) => String(ReadTool.toModelContent(name, page.offset, result)).split("\n")),
        )
      const long = Array.from({ length: 1_800 }, (_, index) => `${index + 1}`.padEnd(1_000, "x"))

      expect(yield* read("short.txt", "one\ntwo\nthree\nfour\nfive\n", { offset: 9, limit: 2 })).toEqual([
        "Read file short.txt, lines 4-5 (offset 9 is past the end; the file has 5 lines)",
        "4: four",
        "5: five",
      ])
      expect(yield* read("empty.txt", "", { offset: 5 })).toEqual([
        "Read file empty.txt, 0 lines (offset 5 is past the end; the file has 0 lines)",
      ])
      // The 50 KB cap keeps the last 51 of 100 tail lines, still ending at the last line.
      const tail = yield* read("long.txt", long.join("\n"), { offset: 2_000, limit: 2_000 })
      expect([tail[0], tail.at(-1)]).toEqual([
        "Read file long.txt, lines 1750-1800 (offset 2000 is past the end; the file has 1800 lines)",
        `1800: ${long.at(-1)}`,
      ])
    }),
  )

  it.effect("returns the last lines of a file larger than the first chunk when the offset is past the end", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const read = (name: string, content: string | Uint8Array, page: ReadToolFileSystem.PageInput) =>
        (typeof content === "string"
          ? files.writeFileString(path.join(directory, name), content)
          : files.writeFile(path.join(directory, name), content)
        ).pipe(
          Effect.andThen(ReadToolFileSystem.read(environment, absolute(path.join(directory, name)), name, page)),
          Effect.map((result) => String(ReadTool.toModelContent(name, page.offset, result)).split("\n")),
        )
      const lines = Array.from({ length: 3_000 }, (_, index) => `${index + 1}`.padEnd(100, "x"))
      const expected = (from: number) =>
        lines.slice(from - 1).map((line, index) => `${from + index}: ${line}`)

      expect(yield* read("lf.txt", lines.join("\n") + "\n", { offset: 5_000 })).toEqual([
        "Read file lf.txt, lines 2901-3000 (offset 5000 is past the end; the file has 3000 lines)",
        ...expected(2_901),
      ])
      expect(yield* read("unterminated.txt", lines.join("\n"), { offset: 3_001 })).toEqual([
        "Read file unterminated.txt, lines 2901-3000 (offset 3001 is past the end; the file has 3000 lines)",
        ...expected(2_901),
      ])
      expect(yield* read("crlf.txt", lines.join("\r\n") + "\r\n", { offset: 3_001, limit: 5 })).toEqual([
        "Read file crlf.txt, lines 2996-3000 (offset 3001 is past the end; the file has 3000 lines)",
        ...expected(2_996),
      ])
      expect(yield* read("crlf-unterminated.txt", lines.join("\r\n"), { offset: 4_000, limit: 1 })).toEqual([
        "Read file crlf-unterminated.txt, lines 3000-3000 (offset 4000 is past the end; the file has 3000 lines)",
        ...expected(3_000),
      ])

      // A mid-file byte order mark is line content, not a decoder signature.
      const marked = lines.map((line, index) => (index === 2_900 ? `\uFEFF${line}` : line))
      expect((yield* read("bom.txt", marked.join("\n"), { offset: 3_001 }))[1]).toBe(`2901: \uFEFF${lines[2_900]}`)

      const huge = yield* read("huge-last.txt", `${lines.slice(0, 10).join("\n")}\n${"z".repeat(300 * 1024)}`, {
        offset: 12,
      })
      expect(huge).toEqual([
        "Read file huge-last.txt, lines 1-11 (offset 12 is past the end; the file has 11 lines)",
        ...expected(1).slice(0, 10),
        `11: ${"z".repeat(2_000)}... (line truncated to 2000 chars)`,
      ])

      // Each clamped line is 2041 bytes, so 25 of them fit in the 50 KB cap.
      const wide = Array.from({ length: 200 }, (_, index) => `${index + 1}`.padEnd(3_000, "w"))
      const capped = yield* read("wide.txt", wide.join("\n") + "\n", { offset: 201 })
      expect(capped[0]).toBe("Read file wide.txt, lines 176-200 (offset 201 is past the end; the file has 200 lines)")
      expect(capped.slice(1)).toEqual(
        wide.slice(175).map((line, index) => `${176 + index}: ${line.slice(0, 2_000)}... (line truncated to 2000 chars)`),
      )

      // Matches whole-file reads: a null byte anywhere in the file rejects a past-end read.
      const early = new TextEncoder().encode(lines.join("\n"))
      early[10] = 0
      const binary = yield* read("early-nul.txt", early, { offset: 3_001 }).pipe(Effect.flip)
      expect(binary).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
    }),
  )

  it.effect("starts a negative offset that many lines before the end", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const read = (name: string, content: string, page: ReadToolFileSystem.PageInput) =>
        files.writeFileString(path.join(directory, name), content).pipe(
          Effect.andThen(ReadToolFileSystem.read(environment, absolute(path.join(directory, name)), name, page)),
          Effect.map((result) => String(ReadTool.toModelContent(name, page.offset, result)).split("\n")),
        )
      const small = "one\ntwo\nthree\nfour\nfive\n"

      expect(yield* read("small.txt", small, { offset: -3 })).toEqual([
        "Read file small.txt, lines 3-5",
        "3: three",
        "4: four",
        "5: five",
      ])
      expect(yield* read("all.txt", small, { offset: -50 })).toEqual([
        "Read file all.txt, lines 1-5",
        "1: one",
        "2: two",
        "3: three",
        "4: four",
        "5: five",
      ])
      expect(yield* read("limited.txt", small, { offset: -4, limit: 2 })).toEqual([
        "Read file limited.txt, lines 2-3",
        "2: two",
        "3: three",
        "[Output truncated. Continue reading with offset: 4]",
      ])
      expect(yield* read("crlf.txt", "one\r\ntwo\r\nthree\r\n", { offset: -2 })).toEqual([
        "Read file crlf.txt, lines 2-3",
        "2: two",
        "3: three",
      ])
      expect(yield* read("unterminated.txt", "one\ntwo\nthree", { offset: -1 })).toEqual([
        "Read file unterminated.txt, lines 3-3",
        "3: three",
      ])
      expect(yield* read("empty.txt", "", { offset: -5 })).toEqual(["Read file empty.txt, 0 lines"])
    }),
  )

  it.effect("starts a negative offset from the end of a file larger than the first chunk", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const read = (name: string, content: string, page: ReadToolFileSystem.PageInput) =>
        files.writeFileString(path.join(directory, name), content).pipe(
          Effect.andThen(ReadToolFileSystem.read(environment, absolute(path.join(directory, name)), name, page)),
          Effect.map((result) => String(ReadTool.toModelContent(name, page.offset, result)).split("\n")),
        )
      const lines = Array.from({ length: 3_000 }, (_, index) => `${index + 1}`.padEnd(100, "x"))
      const expected = (from: number, to = 3_000) =>
        lines.slice(from - 1, to).map((line, index) => `${from + index}: ${line}`)

      expect(yield* read("lf.txt", lines.join("\n") + "\n", { offset: -50 })).toEqual([
        "Read file lf.txt, lines 2951-3000",
        ...expected(2_951),
      ])
      expect(yield* read("window.txt", lines.join("\n") + "\n", { offset: -50, limit: 10 })).toEqual([
        "Read file window.txt, lines 2951-2960",
        ...expected(2_951, 2_960),
        "[Output truncated. Continue reading with offset: 2961]",
      ])
      expect(yield* read("crlf.txt", lines.join("\r\n"), { offset: -3 })).toEqual([
        "Read file crlf.txt, lines 2998-3000",
        ...expected(2_998),
      ])
      // 3000 lines of 101 bytes exceed the 50 KB cap, so reading from line 1 stops after 506 like any read.
      const whole = yield* read("whole.txt", lines.join("\n") + "\n", { offset: -5_000 })
      expect([whole[0], whole.at(-2), whole.at(-1)]).toEqual([
        "Read file whole.txt, lines 1-506",
        `506: ${lines[505]}`,
        "[Output truncated. Continue reading with offset: 507]",
      ])
      // Each clamped line is 2041 bytes, so 25 of them fit in the 50 KB cap.
      const wide = Array.from({ length: 200 }, (_, index) => `${index + 1}`.padEnd(3_000, "w"))
      const clipped = yield* read("wide.txt", wide.join("\n") + "\n", { offset: -100 })
      expect([clipped[0], clipped.at(-1)]).toEqual([
        "Read file wide.txt, lines 101-125",
        "[Output truncated. Continue reading with offset: 126]",
      ])
      const short = lines.slice(0, 10)
      const huge = yield* read("huge.txt", `${short.join("\n")}\n${"z".repeat(300 * 1024)}`, { offset: -20 })
      expect(huge).toEqual([
        "Read file huge.txt, lines 1-11",
        ...expected(1, 10),
        `11: ${"z".repeat(2_000)}... (line truncated to 2000 chars)`,
      ])
    }),
  )

  it.effect("rejects a negative offset for a directory", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      yield* files.writeFileString(path.join(directory, "a.txt"), "a\n")

      const error = yield* ReadToolFileSystem.read(environment, absolute(directory), "src", { offset: -1 }).pipe(
        Effect.flip,
      )
      expect(error).toBeInstanceOf(ReadToolFileSystem.DirectoryOffsetError)
      expect(error.message).toBe("A negative offset only works for files, and src is a directory")
    }),
  )

  it.effect("pages text with one-based offsets", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "lines.txt")
      yield* files.writeFileString(file, "one\r\ntwo\nthree")

      const result = yield* ReadToolFileSystem.read(environment, absolute(file), "lines.txt", {
        offset: 2,
        limit: 1,
      })

      expect(result).toMatchObject({ type: "text-page", content: "two", offset: 2, truncated: true, next: 3 })
    }),
  )

  it.effect("truncates long lines", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "long.txt")
      yield* files.writeFileString(file, `${"a".repeat(1_999)}😀tail`)

      const result = yield* ReadToolFileSystem.read(environment, absolute(file), "long.txt", { limit: 1 })

      expect(result).toMatchObject({
        type: "text-page",
        content: `${"a".repeat(1_999)}... (line truncated to 2000 chars)`,
        truncated: false,
      })
    }),
  )

  it.effect("enforces line and byte budgets with continuation offsets", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const linesFile = path.join(directory, "many-lines.txt")
      const bytesFile = path.join(directory, "many-bytes.txt")
      yield* files.writeFileString(linesFile, Array.from({ length: 2_001 }, (_, index) => String(index)).join("\n"))
      yield* files.writeFileString(bytesFile, Array.from({ length: 200 }, () => "a".repeat(2_000)).join("\n"))
      const ranges: Array<{ readonly offset: number; readonly length: number } | undefined> = []
      const tracked = {
        ...environment,
        read: (path: string, range?: { readonly offset: number; readonly length: number }) =>
          Effect.sync(() => ranges.push(range)).pipe(Effect.andThen(environment.read(path, range))),
      }

      const lines = yield* ReadToolFileSystem.read(environment, absolute(linesFile), "many-lines.txt", { limit: 2_000 })
      const bytes = yield* ReadToolFileSystem.read(tracked, absolute(bytesFile), "many-bytes.txt", {})

      expect(lines).toMatchObject({ type: "text-page", truncated: true, next: 2_001 })
      expect(lines.type === "text-page" ? lines.content.split("\n") : []).toHaveLength(2_000)
      expect(bytes).toMatchObject({ type: "text-page", truncated: true, next: 26 })
      expect(bytes.type === "text-page" ? Buffer.byteLength(bytes.content) : Infinity).toBeLessThanOrEqual(
        ReadToolFileSystem.MAX_READ_BYTES,
      )
      expect(ranges).toEqual([{ offset: 0, length: 256 * 1024 }])
    }),
  )

  it.effect("sorts and pages directory entries", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      yield* files.makeDirectory(path.join(directory, "z"))
      yield* files.makeDirectory(path.join(directory, "a"))
      yield* files.writeFileString(path.join(directory, "b.txt"), "")

      const result = yield* ReadToolFileSystem.read(environment, absolute(directory), "folder", {
        offset: 2,
        limit: 1,
      })

      expect(result).toMatchObject({
        type: "list-page",
        entries: [{ path: `z${path.sep}`, type: "directory" }],
        truncated: true,
        next: 3,
      })
    }),
  )

  it.effect("stops checking for null bytes after the requested page", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "nul.txt")
      yield* files.writeFile(file, Uint8Array.from([...new TextEncoder().encode("one\n"), 0]))

      const result = yield* ReadToolFileSystem.read(environment, absolute(file), "nul.txt", { limit: 1 })

      expect(result).toMatchObject({ type: "text-page", content: "one", truncated: true, next: 2 })
    }),
  )

  it.effect("checks skipped lines for null bytes", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "nul-prefix.txt")
      yield* files.writeFile(file, Uint8Array.from([...new TextEncoder().encode("one"), 0, 10, 116, 119, 111, 10]))

      const error = yield* ReadToolFileSystem.read(environment, absolute(file), "nul-prefix.txt", {
        offset: 2,
        limit: 1,
      }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
    }),
  )

  it.effect("reads page two after fetching more than the first 256KB range", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "large.txt")
      yield* files.writeFileString(file, `${"a".repeat(300 * 1024)}\nsecond\n`)

      const result = yield* ReadToolFileSystem.read(environment, absolute(file), "large.txt", {
        offset: 2,
        limit: 1,
      })

      expect(result).toMatchObject({ type: "text-page", content: "second", offset: 2, truncated: false })
    }),
  )

  it.effect("reads after a newline at the first chunk boundary", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "boundary.txt")
      yield* files.writeFileString(file, `${"a".repeat(256 * 1024 - 1)}\nsecond\n`)

      const result = yield* ReadToolFileSystem.read(environment, absolute(file), "boundary.txt", {
        offset: 2,
        limit: 1,
      })

      expect(result).toMatchObject({ type: "text-page", content: "second", offset: 2, truncated: false })
    }),
  )

  it.effect("preserves the media ingestion limit message", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "oversized.png")
      yield* files.writeFile(file, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
      yield* files.truncate(file, ReadToolFileSystem.MAX_MEDIA_INGEST_BYTES + 1)

      const error = yield* ReadToolFileSystem.read(environment, absolute(file), "oversized.png").pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.MediaIngestLimitError)
      expect(error.message).toBe(
        `Media exceeds ${ReadToolFileSystem.MAX_MEDIA_INGEST_BYTES} byte ingestion limit: oversized.png`,
      )
    }),
  )

  it.effect("reads PDFs as bounded media", () =>
    Effect.gen(function* () {
      const { environment, files, directory } = yield* fixture
      const file = path.join(directory, "document.pdf")
      yield* files.writeFileString(file, "%PDF-1.7\ncontent")

      const result = yield* ReadToolFileSystem.read(environment, absolute(file), "document.pdf")

      expect(result).toMatchObject({
        type: "file",
        content: Buffer.from("%PDF-1.7\ncontent").toString("base64"),
        encoding: "base64",
        mime: "application/pdf",
      })
    }),
  )
})
