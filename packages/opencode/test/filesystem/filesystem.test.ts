import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "../../src/filesystem"
import { testEffect } from "../lib/effect"
import path from "path"

const live = AppFileSystem.layer.pipe(Layer.provide(NodeFileSystem.layer))
const { effect: it } = testEffect(live)

describe("AppFileSystem", () => {
  describe("isDir", () => {
    it(
      "returns true for directories",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        expect(yield* fs.isDir(tmp)).toBe(true)
      }),
    )

    it(
      "returns false for files",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "test.txt")
        yield* fs.writeFileString(file, "hello")
        expect(yield* fs.isDir(file)).toBe(false)
      }),
    )

    it(
      "returns false for non-existent paths",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        expect(yield* fs.isDir("/tmp/nonexistent-" + Math.random())).toBe(false)
      }),
    )
  })

  describe("isFile", () => {
    it(
      "returns true for files",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "test.txt")
        yield* fs.writeFileString(file, "hello")
        expect(yield* fs.isFile(file)).toBe(true)
      }),
    )

    it(
      "returns false for directories",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        expect(yield* fs.isFile(tmp)).toBe(false)
      }),
    )
  })

  describe("readJson / writeJson", () => {
    it(
      "round-trips JSON data",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "data.json")
        const data = { name: "test", count: 42, nested: { ok: true } }

        yield* fs.writeJson(file, data)
        const result = yield* fs.readJson(file)

        expect(result).toEqual(data)
      }),
    )
  })

  describe("ensureDir", () => {
    it(
      "creates nested directories",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const nested = path.join(tmp, "a", "b", "c")

        yield* fs.ensureDir(nested)

        const info = yield* fs.stat(nested)
        expect(info.type).toBe("Directory")
      }),
    )

    it(
      "is idempotent",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const dir = path.join(tmp, "existing")
        yield* fs.makeDirectory(dir)

        yield* fs.ensureDir(dir)

        const info = yield* fs.stat(dir)
        expect(info.type).toBe("Directory")
      }),
    )
  })

  describe("writeWithDirs", () => {
    it(
      "creates parent directories if missing",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "deep", "nested", "file.txt")

        yield* fs.writeWithDirs(file, "hello")

        expect(yield* fs.readFileString(file)).toBe("hello")
      }),
    )

    it(
      "writes directly when parent exists",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "direct.txt")

        yield* fs.writeWithDirs(file, "world")

        expect(yield* fs.readFileString(file)).toBe("world")
      }),
    )

    it(
      "writes Uint8Array content",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "binary.bin")
        const content = new Uint8Array([0x00, 0x01, 0x02, 0x03])

        yield* fs.writeWithDirs(file, content)

        const result = yield* fs.readFile(file)
        expect(new Uint8Array(result)).toEqual(content)
      }),
    )
  })

  describe("findUp", () => {
    it(
      "finds target in start directory",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(tmp, "target.txt"), "found")

        const result = yield* fs.findUp("target.txt", tmp)
        expect(result).toEqual([path.join(tmp, "target.txt")])
      }),
    )

    it(
      "finds target in parent directories",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(tmp, "marker"), "root")
        const child = path.join(tmp, "a", "b")
        yield* fs.makeDirectory(child, { recursive: true })

        const result = yield* fs.findUp("marker", child, tmp)
        expect(result).toEqual([path.join(tmp, "marker")])
      }),
    )

    it(
      "returns empty array when not found",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const result = yield* fs.findUp("nonexistent", tmp, tmp)
        expect(result).toEqual([])
      }),
    )
  })

  describe("up", () => {
    it(
      "finds multiple targets walking up",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(tmp, "a.txt"), "a")
        yield* fs.writeFileString(path.join(tmp, "b.txt"), "b")
        const child = path.join(tmp, "sub")
        yield* fs.makeDirectory(child)
        yield* fs.writeFileString(path.join(child, "a.txt"), "a-child")

        const result = yield* fs.up({ targets: ["a.txt", "b.txt"], start: child, stop: tmp })

        expect(result).toContain(path.join(child, "a.txt"))
        expect(result).toContain(path.join(tmp, "a.txt"))
        expect(result).toContain(path.join(tmp, "b.txt"))
      }),
    )
  })

  describe("glob", () => {
    it(
      "finds files matching pattern",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(tmp, "a.ts"), "a")
        yield* fs.writeFileString(path.join(tmp, "b.ts"), "b")
        yield* fs.writeFileString(path.join(tmp, "c.json"), "c")

        const result = yield* fs.glob("*.ts", { cwd: tmp })
        expect(result.sort()).toEqual(["a.ts", "b.ts"])
      }),
    )

    it(
      "supports absolute paths",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(tmp, "file.txt"), "hello")

        const result = yield* fs.glob("*.txt", { cwd: tmp, absolute: true })
        expect(result).toEqual([path.join(tmp, "file.txt")])
      }),
    )
  })

  describe("globMatch", () => {
    it(
      "matches patterns",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        expect(fs.globMatch("*.ts", "foo.ts")).toBe(true)
        expect(fs.globMatch("*.ts", "foo.json")).toBe(false)
        expect(fs.globMatch("src/**", "src/a/b.ts")).toBe(true)
      }),
    )
  })

  describe("globUp", () => {
    it(
      "finds files walking up directories",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(tmp, "root.md"), "root")
        const child = path.join(tmp, "a", "b")
        yield* fs.makeDirectory(child, { recursive: true })
        yield* fs.writeFileString(path.join(child, "leaf.md"), "leaf")

        const result = yield* fs.globUp("*.md", child, tmp)
        expect(result).toContain(path.join(child, "leaf.md"))
        expect(result).toContain(path.join(tmp, "root.md"))
      }),
    )
  })

  describe("built-in passthrough", () => {
    it(
      "exists works",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "exists.txt")
        yield* fs.writeFileString(file, "yes")

        expect(yield* fs.exists(file)).toBe(true)
        expect(yield* fs.exists(file + ".nope")).toBe(false)
      }),
    )

    it(
      "remove works",
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const tmp = yield* fs.makeTempDirectoryScoped()
        const file = path.join(tmp, "delete-me.txt")
        yield* fs.writeFileString(file, "bye")

        yield* fs.remove(file)

        expect(yield* fs.exists(file)).toBe(false)
      }),
    )
  })

  describe("pure helpers", () => {
    test("mimeType returns correct types", () => {
      expect(AppFileSystem.mimeType("file.json")).toBe("application/json")
      expect(AppFileSystem.mimeType("image.png")).toBe("image/png")
      expect(AppFileSystem.mimeType("unknown.qzx")).toBe("application/octet-stream")
    })

    test("contains checks path containment", () => {
      expect(AppFileSystem.contains("/a/b", "/a/b/c")).toBe(true)
      expect(AppFileSystem.contains("/a/b", "/a/c")).toBe(false)
    })

    test("overlaps detects overlapping paths", () => {
      expect(AppFileSystem.overlaps("/a/b", "/a/b/c")).toBe(true)
      expect(AppFileSystem.overlaps("/a/b/c", "/a/b")).toBe(true)
      expect(AppFileSystem.overlaps("/a", "/b")).toBe(false)
    })
  })
})
