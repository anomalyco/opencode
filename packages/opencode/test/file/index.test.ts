import { afterEach, describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { $ } from "bun"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { File } from "../../src/file"
import { Filesystem } from "@/util/filesystem"
import { disposeAllInstances, TestInstance, withTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(Layer.mergeAll(File.defaultLayer, AppFileSystem.defaultLayer))

const init = Effect.fn("FileTest.init")(function* () {
  const file = yield* File.Service
  return yield* file.init()
})

const status = Effect.fn("FileTest.status")(function* () {
  const file = yield* File.Service
  return yield* file.status()
})

const read = Effect.fn("FileTest.read")(function* (input: string) {
  const file = yield* File.Service
  return yield* file.read(input)
})

const list = Effect.fn("FileTest.list")(function* (dir?: string) {
  const file = yield* File.Service
  return yield* file.list(dir)
})

const search = Effect.fn("FileTest.search")(function* (input: {
  query: string
  limit?: number
  dirs?: boolean
  type?: "file" | "directory"
}) {
  const file = yield* File.Service
  return yield* file.search(input)
})

const gitAddAll = (directory: string) => Effect.promise(() => $`git add .`.cwd(directory).quiet())
const gitCommit = (directory: string, message: string) =>
  Effect.promise(() => $`git commit -m ${message}`.cwd(directory).quiet())

const failureMessage = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      return error instanceof Error ? error.message : String(error)
    }
    throw new Error("expected effect to fail")
  })

const setupSearchableRepo = Effect.fn("FileTest.setupSearchableRepo")(function* (directory: string) {
  const fsys = yield* AppFileSystem.Service
  yield* fsys.writeWithDirs(path.join(directory, "index.ts"), "code")
  yield* fsys.writeWithDirs(path.join(directory, "utils.ts"), "utils")
  yield* fsys.writeWithDirs(path.join(directory, "readme.md"), "readme")
  yield* fsys.writeWithDirs(path.join(directory, "src", "main.ts"), "main")
  yield* fsys.writeWithDirs(path.join(directory, ".hidden", "secret.ts"), "secret")
})

describe("file/index Filesystem patterns", () => {
  describe("read() - text content", () => {
    it.instance("reads text file via Filesystem.readText()", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "test.txt"), "Hello World", "utf-8"))

        const result = yield* read("test.txt")
        expect(result.type).toBe("text")
        expect(result.content).toBe("Hello World")
      }),
    )

    it.instance("reads with Filesystem.exists() check", () =>
      Effect.gen(function* () {
        const result = yield* read("nonexistent.txt")
        expect(result.type).toBe("text")
        expect(result.content).toBe("")
      }),
    )

    it.instance("trims whitespace from text content", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() =>
          fs.writeFile(path.join(test.directory, "test.txt"), "  content with spaces  \n\n", "utf-8"),
        )

        const result = yield* read("test.txt")
        expect(result.content).toBe("content with spaces")
      }),
    )

    it.instance("handles empty text file", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "empty.txt"), "", "utf-8"))

        const result = yield* read("empty.txt")
        expect(result.type).toBe("text")
        expect(result.content).toBe("")
      }),
    )

    it.instance("handles multi-line text files", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "multiline.txt"), "line1\nline2\nline3", "utf-8"))

        const result = yield* read("multiline.txt")
        expect(result.content).toBe("line1\nline2\nline3")
      }),
    )
  })

  describe("read() - binary content", () => {
    it.instance("reads binary file via Filesystem.readArrayBuffer()", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "image.png"), binaryContent))

        const result = yield* read("image.png")
        expect(result.type).toBe("text")
        expect(result.encoding).toBe("base64")
        expect(result.mimeType).toBe("image/png")
        expect(result.content).toBe(binaryContent.toString("base64"))
      }),
    )

    it.instance("returns empty for binary non-image files", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "binary.so"), Buffer.from([0x7f, 0x45, 0x4c, 0x46])))

        const result = yield* read("binary.so")
        expect(result.type).toBe("binary")
        expect(result.content).toBe("")
      }),
    )
  })

  describe("read() - Filesystem.mimeType()", () => {
    it.instance("detects MIME type via Filesystem.mimeType()", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "test.json")
        yield* Effect.promise(() => fs.writeFile(filepath, '{"key": "value"}', "utf-8"))

        expect(yield* Effect.promise(() => Filesystem.mimeType(filepath))).toContain("application/json")

        const result = yield* read("test.json")
        expect(result.type).toBe("text")
      }),
    )

    it.instance("handles various image MIME types", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const testCases = [
          { ext: "jpg", mime: "image/jpeg" },
          { ext: "png", mime: "image/png" },
          { ext: "gif", mime: "image/gif" },
          { ext: "webp", mime: "image/webp" },
        ]

        for (const testCase of testCases) {
          const filepath = path.join(test.directory, `test.${testCase.ext}`)
          yield* Effect.promise(() => fs.writeFile(filepath, Buffer.from([0x00, 0x00, 0x00, 0x00])))
          expect(yield* Effect.promise(() => Filesystem.mimeType(filepath))).toContain(testCase.mime)
        }
      }),
    )
  })

  describe("list() - Filesystem.exists() and readText()", () => {
    it.instance(
      "reads .gitignore via Filesystem.exists() and readText()",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const gitignorePath = path.join(test.directory, ".gitignore")
          yield* Effect.promise(() => fs.writeFile(gitignorePath, "node_modules\ndist\n", "utf-8"))

          expect(yield* Effect.promise(() => Filesystem.exists(gitignorePath))).toBe(true)
          expect(yield* Effect.promise(() => Filesystem.readText(gitignorePath))).toContain("node_modules")
        }),
      { git: true },
    )

    it.instance(
      "reads .ignore file similarly",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const ignorePath = path.join(test.directory, ".ignore")
          yield* Effect.promise(() => fs.writeFile(ignorePath, "*.log\n.env\n", "utf-8"))

          expect(yield* Effect.promise(() => Filesystem.exists(ignorePath))).toBe(true)
          expect(yield* Effect.promise(() => Filesystem.readText(ignorePath))).toContain("*.log")
        }),
      { git: true },
    )

    it.instance(
      "handles missing .gitignore gracefully",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const gitignorePath = path.join(test.directory, ".gitignore")
          expect(yield* Effect.promise(() => Filesystem.exists(gitignorePath))).toBe(false)

          const nodes = yield* list()
          expect(Array.isArray(nodes)).toBe(true)
        }),
      { git: true },
    )
  })

  describe("File.changed() - Filesystem.readText() for untracked files", () => {
    it.instance(
      "reads untracked files via Filesystem.readText()",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const untrackedPath = path.join(test.directory, "untracked.txt")
          yield* Effect.promise(() => fs.writeFile(untrackedPath, "new content\nwith multiple lines", "utf-8"))

          const content = yield* Effect.promise(() => Filesystem.readText(untrackedPath))
          expect(content.split("\n").length).toBe(2)
        }),
      { git: true },
    )
  })

  describe("Error handling", () => {
    it.instance("handles errors gracefully in Filesystem.readText()", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "readonly.txt"), "content", "utf-8"))

        const nonExistentPath = path.join(test.directory, "does-not-exist.txt")
        expect(Exit.isFailure(yield* Effect.promise(() => Filesystem.readText(nonExistentPath)).pipe(Effect.exit))).toBe(true)

        const result = yield* read("does-not-exist.txt")
        expect(result.content).toBe("")
      }),
    )

    it.instance("handles errors in Filesystem.readArrayBuffer()", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const nonExistentPath = path.join(test.directory, "does-not-exist.bin")
        const buffer = yield* Effect.promise(() => Filesystem.readArrayBuffer(nonExistentPath).catch(() => new ArrayBuffer(0)))
        expect(buffer.byteLength).toBe(0)
      }),
    )

    it.instance("returns empty array buffer on error for images", () =>
      Effect.gen(function* () {
        const result = yield* read("broken.png")
        expect(result.type).toBe("text")
        expect(result.content).toBe("")
      }),
    )
  })

  describe("shouldEncode() logic", () => {
    it.instance("treats .ts files as text", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "test.ts"), "export const value = 1", "utf-8"))

        const result = yield* read("test.ts")
        expect(result.type).toBe("text")
        expect(result.content).toBe("export const value = 1")
      }),
    )

    it.instance("treats .mts files as text", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "test.mts"), "export const value = 1", "utf-8"))

        const result = yield* read("test.mts")
        expect(result.type).toBe("text")
        expect(result.content).toBe("export const value = 1")
      }),
    )

    it.instance("treats .sh files as text", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "test.sh"), "#!/usr/bin/env bash\necho hello", "utf-8"))

        const result = yield* read("test.sh")
        expect(result.type).toBe("text")
        expect(result.content).toBe("#!/usr/bin/env bash\necho hello")
      }),
    )

    it.instance("treats Dockerfile as text", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "Dockerfile"), "FROM alpine:3.20", "utf-8"))

        const result = yield* read("Dockerfile")
        expect(result.type).toBe("text")
        expect(result.content).toBe("FROM alpine:3.20")
      }),
    )

    it.instance("returns encoding info for text files", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "test.txt"), "simple text", "utf-8"))

        const result = yield* read("test.txt")
        expect(result.encoding).toBeUndefined()
        expect(result.type).toBe("text")
      }),
    )

    it.instance("returns base64 encoding for images", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "test.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0])))

        const result = yield* read("test.jpg")
        expect(result.encoding).toBe("base64")
        expect(result.mimeType).toBe("image/jpeg")
      }),
    )
  })

  describe("Path security", () => {
    it.instance("throws for paths outside project directory", () =>
      Effect.gen(function* () {
        expect(yield* failureMessage(read("../outside.txt"))).toContain("Access denied")
      }),
    )

    it.instance("throws for paths outside project directory", () =>
      Effect.gen(function* () {
        expect(yield* failureMessage(read("../outside.txt"))).toContain("Access denied")
      }),
    )
  })

  describe("status()", () => {
    it.instance(
      "detects modified file",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const filepath = path.join(test.directory, "file.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "original\n", "utf-8"))
          yield* gitAddAll(test.directory)
          yield* gitCommit(test.directory, "add file")
          yield* Effect.promise(() => fs.writeFile(filepath, "modified\nextra line\n", "utf-8"))

          const result = yield* status()
          const entry = result.find((file) => file.path === "file.txt")
          expect(entry).toBeDefined()
          expect(entry!.status).toBe("modified")
          expect(entry!.added).toBeGreaterThan(0)
          expect(entry!.removed).toBeGreaterThan(0)
        }),
      { git: true },
    )

    it.instance(
      "detects untracked file as added",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "new.txt"), "line1\nline2\nline3\n", "utf-8"))

          const result = yield* status()
          const entry = result.find((file) => file.path === "new.txt")
          expect(entry).toBeDefined()
          expect(entry!.status).toBe("added")
          expect(entry!.added).toBe(4)
          expect(entry!.removed).toBe(0)
        }),
      { git: true },
    )

    it.instance(
      "detects deleted file",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const filepath = path.join(test.directory, "gone.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "content\n", "utf-8"))
          yield* gitAddAll(test.directory)
          yield* gitCommit(test.directory, "add file")
          yield* Effect.promise(() => fs.rm(filepath))

          const result = yield* status()
          const entries = result.filter((file) => file.path === "gone.txt")
          expect(entries.some((entry) => entry.status === "deleted")).toBe(true)
        }),
      { git: true },
    )

    it.instance(
      "detects mixed changes",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "keep.txt"), "keep\n", "utf-8"))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "remove.txt"), "remove\n", "utf-8"))
          yield* gitAddAll(test.directory)
          yield* gitCommit(test.directory, "initial")

          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "keep.txt"), "changed\n", "utf-8"))
          yield* Effect.promise(() => fs.rm(path.join(test.directory, "remove.txt")))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "brand-new.txt"), "hello\n", "utf-8"))

          const result = yield* status()
          expect(result.some((file) => file.path === "keep.txt" && file.status === "modified")).toBe(true)
          expect(result.some((file) => file.path === "remove.txt" && file.status === "deleted")).toBe(true)
          expect(result.some((file) => file.path === "brand-new.txt" && file.status === "added")).toBe(true)
        }),
      { git: true },
    )

    it.instance("returns empty for non-git project", () =>
      Effect.gen(function* () {
        expect(yield* status()).toEqual([])
      }),
    )

    it.instance(
      "returns empty for clean repo",
      () =>
        Effect.gen(function* () {
          expect(yield* status()).toEqual([])
        }),
      { git: true },
    )

    it.instance(
      "parses binary numstat as 0",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const filepath = path.join(test.directory, "data.bin")
          yield* Effect.promise(() => fs.writeFile(filepath, Buffer.from(Array.from({ length: 256 }, (_, index) => index))))
          yield* gitAddAll(test.directory)
          yield* gitCommit(test.directory, "add binary")
          yield* Effect.promise(() => fs.writeFile(filepath, Buffer.from(Array.from({ length: 512 }, (_, index) => index % 256))))

          const result = yield* status()
          const entry = result.find((file) => file.path === "data.bin")
          expect(entry).toBeDefined()
          expect(entry!.status).toBe("modified")
          expect(entry!.added).toBe(0)
          expect(entry!.removed).toBe(0)
        }),
      { git: true },
    )
  })

  describe("list()", () => {
    it.instance(
      "returns files and directories with correct shape",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.mkdir(path.join(test.directory, "subdir")))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "file.txt"), "content", "utf-8"))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "subdir", "nested.txt"), "nested", "utf-8"))

          const nodes = yield* list()
          expect(nodes.length).toBeGreaterThanOrEqual(2)
          for (const node of nodes) {
            expect(node).toHaveProperty("name")
            expect(node).toHaveProperty("path")
            expect(node).toHaveProperty("absolute")
            expect(node).toHaveProperty("type")
            expect(node).toHaveProperty("ignored")
            expect(["file", "directory"]).toContain(node.type)
          }
        }),
      { git: true },
    )

    it.instance(
      "sorts directories before files, alphabetical within each",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.mkdir(path.join(test.directory, "beta")))
          yield* Effect.promise(() => fs.mkdir(path.join(test.directory, "alpha")))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "zz.txt"), "", "utf-8"))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "aa.txt"), "", "utf-8"))

          const nodes = yield* list()
          const dirs = nodes.filter((node) => node.type === "directory")
          const files = nodes.filter((node) => node.type === "file")
          const firstFile = nodes.findIndex((node) => node.type === "file")
          const lastDir = nodes.findLastIndex((node) => node.type === "directory")
          if (lastDir >= 0 && firstFile >= 0) {
            expect(lastDir).toBeLessThan(firstFile)
          }
          expect(dirs.map((dir) => dir.name)).toEqual(dirs.map((dir) => dir.name).toSorted())
          expect(files.map((file) => file.name)).toEqual(files.map((file) => file.name).toSorted())
        }),
      { git: true },
    )

    it.instance(
      "excludes .git and .DS_Store",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, ".DS_Store"), "", "utf-8"))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "visible.txt"), "", "utf-8"))

          const names = (yield* list()).map((node) => node.name)
          expect(names).not.toContain(".git")
          expect(names).not.toContain(".DS_Store")
          expect(names).toContain("visible.txt")
        }),
      { git: true },
    )

    it.instance(
      "marks gitignored files as ignored",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, ".gitignore"), "*.log\nbuild/\n", "utf-8"))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "app.log"), "log data", "utf-8"))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "main.ts"), "code", "utf-8"))
          yield* Effect.promise(() => fs.mkdir(path.join(test.directory, "build")))

          const nodes = yield* list()
          expect(nodes.find((node) => node.name === "app.log")?.ignored).toBe(true)
          expect(nodes.find((node) => node.name === "main.ts")?.ignored).toBe(false)
          expect(nodes.find((node) => node.name === "build")?.ignored).toBe(true)
        }),
      { git: true },
    )

    it.instance(
      "lists subdirectory contents",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.mkdir(path.join(test.directory, "sub")))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "sub", "a.txt"), "", "utf-8"))
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "sub", "b.txt"), "", "utf-8"))

          const nodes = yield* list("sub")
          expect(nodes.length).toBe(2)
          expect(nodes.map((node) => node.name).sort()).toEqual(["a.txt", "b.txt"])
          expect(nodes[0].path.replaceAll("\\", "/").startsWith("sub/")).toBe(true)
        }),
      { git: true },
    )

    it.instance(
      "throws for paths outside project directory",
      () =>
        Effect.gen(function* () {
          expect(yield* failureMessage(list("../outside"))).toContain("Access denied")
        }),
      { git: true },
    )

    it.instance("works without git", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "file.txt"), "hi", "utf-8"))

        const nodes = yield* list()
        expect(nodes.length).toBeGreaterThanOrEqual(1)
        for (const node of nodes) {
          expect(node.ignored).toBe(false)
        }
      }),
    )
  })

  describe("search()", () => {
    it.instance(
      "empty query returns files",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()

          const result = yield* search({ query: "", type: "file" })
          expect(result.length).toBeGreaterThan(0)
        }),
      { git: true },
    )

    it.instance(
      "search works before explicit init",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)

          const result = yield* search({ query: "main", type: "file" })
          expect(result.some((file) => file.includes("main"))).toBe(true)
        }),
      { git: true },
    )

    it.instance(
      "empty query returns dirs sorted with hidden last",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()

          const result = yield* search({ query: "", type: "directory" })
          expect(result.length).toBeGreaterThan(0)
          const firstHidden = result.findIndex((dir) => dir.split("/").some((part) => part.startsWith(".") && part.length > 1))
          const lastVisible = result.findLastIndex((dir) => !dir.split("/").some((part) => part.startsWith(".") && part.length > 1))
          if (firstHidden >= 0 && lastVisible >= 0) {
            expect(firstHidden).toBeGreaterThan(lastVisible)
          }
        }),
      { git: true },
    )

    it.instance(
      "fuzzy matches file names",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()

          const result = yield* search({ query: "main", type: "file" })
          expect(result.some((file) => file.includes("main"))).toBe(true)
        }),
      { git: true },
    )

    it.instance(
      "type filter returns only files",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()

          const result = yield* search({ query: "", type: "file" })
          for (const file of result) {
            expect(file.endsWith("/")).toBe(false)
          }
        }),
      { git: true },
    )

    it.instance(
      "type filter returns only directories",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()

          const result = yield* search({ query: "", type: "directory" })
          for (const dir of result) {
            expect(dir.endsWith("/")).toBe(true)
          }
        }),
      { git: true },
    )

    it.instance(
      "respects limit",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()

          const result = yield* search({ query: "", type: "file", limit: 2 })
          expect(result.length).toBeLessThanOrEqual(2)
        }),
      { git: true },
    )

    it.instance(
      "query starting with dot prefers hidden files",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()

          const result = yield* search({ query: ".hidden", type: "directory" })
          expect(result.length).toBeGreaterThan(0)
          expect(result[0]).toContain(".hidden")
        }),
      { git: true },
    )

    it.instance(
      "search refreshes after init when files change",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* setupSearchableRepo(test.directory)
          yield* init()
          expect(yield* search({ query: "fresh", type: "file" })).toEqual([])

          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "fresh.ts"), "fresh", "utf-8"))

          expect(yield* search({ query: "fresh", type: "file" })).toContain("fresh.ts")
        }),
      { git: true },
    )
  })

  describe("read() - diff/patch", () => {
    it.instance(
      "returns diff and patch for modified tracked file",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const filepath = path.join(test.directory, "file.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "original content\n", "utf-8"))
          yield* gitAddAll(test.directory)
          yield* gitCommit(test.directory, "add file")
          yield* Effect.promise(() => fs.writeFile(filepath, "modified content\n", "utf-8"))

          const result = yield* read("file.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("modified content")
          expect(result.diff).toBeDefined()
          expect(result.diff).toContain("original content")
          expect(result.diff).toContain("modified content")
          expect(result.patch).toBeDefined()
          expect(result.patch!.hunks.length).toBeGreaterThan(0)
        }),
      { git: true },
    )

    it.instance(
      "returns diff for staged changes",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const filepath = path.join(test.directory, "staged.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "before\n", "utf-8"))
          yield* gitAddAll(test.directory)
          yield* gitCommit(test.directory, "add file")
          yield* Effect.promise(() => fs.writeFile(filepath, "after\n", "utf-8"))
          yield* gitAddAll(test.directory)

          const result = yield* read("staged.txt")
          expect(result.diff).toBeDefined()
          expect(result.patch).toBeDefined()
        }),
      { git: true },
    )

    it.instance(
      "returns no diff for unmodified file",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const filepath = path.join(test.directory, "clean.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "unchanged\n", "utf-8"))
          yield* gitAddAll(test.directory)
          yield* gitCommit(test.directory, "add file")

          const result = yield* read("clean.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("unchanged")
          expect(result.diff).toBeUndefined()
          expect(result.patch).toBeUndefined()
        }),
      { git: true },
    )
  })

  describe("InstanceState isolation", () => {
    it.instance(
      "two directories get independent file caches",
      () =>
        Effect.gen(function* () {
          const one = yield* TestInstance
          yield* Effect.promise(() => fs.writeFile(path.join(one.directory, "a.ts"), "one", "utf-8"))
          yield* init()
          expect(yield* search({ query: "a.ts", type: "file" })).toContain("a.ts")
          expect(yield* search({ query: "b.ts", type: "file" })).not.toContain("b.ts")

          yield* Effect.gen(function* () {
            const two = yield* TestInstance
            yield* Effect.promise(() => fs.writeFile(path.join(two.directory, "b.ts"), "two", "utf-8"))
            yield* init()
            expect(yield* search({ query: "b.ts", type: "file" })).toContain("b.ts")
            expect(yield* search({ query: "a.ts", type: "file" })).not.toContain("a.ts")
          }).pipe(withTmpdirInstance({ git: true }))
        }),
      { git: true },
    )

    it.instance(
      "disposal gives fresh state on next access",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "before.ts"), "before", "utf-8"))
          yield* init()
          expect(yield* search({ query: "before", type: "file" })).toContain("before.ts")

          yield* Effect.promise(() => disposeAllInstances())

          yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "after.ts"), "after", "utf-8"))
          yield* Effect.promise(() => fs.rm(path.join(test.directory, "before.ts")))

          yield* init()
          expect(yield* search({ query: "after", type: "file" })).toContain("after.ts")
          expect(yield* search({ query: "before", type: "file" })).not.toContain("before.ts")
        }),
      { git: true },
    )
  })
})
