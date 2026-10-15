import { describe, test, expect, spyOn } from "bun:test"
import os from "os"
import { Effect, FileSystem, Layer } from "effect"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
import { node, Service } from "@opencode/core/filesystem"
import type { FindInput } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import path from "path"

const live = LayerNode.compile(LayerNode.group([FSUtil.node, LayerNodePlatform.filesystem]))
const { effect: it } = testEffect(live)

describe("FSUtil", () => {
  describe("isDir", () => {
    it(
      "returns true for directories",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        expect(yield* fs.isDir(tmp)).toBe(true)
      }),
    )

    it(
      "returns false for files",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "test.txt")
        yield* filesys.writeFileString(file, "hello")
        expect(yield* fs.isDir(file)).toBe(false)
      }),
    )

    it(
      "returns false for non-existent paths",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        expect(yield* fs.isDir("/tmp/nonexistent-" + Math.random())).toBe(false)
      }),
    )
  })

  describe("isFile", () => {
    it(
      "returns true for files",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "test.txt")
        yield* filesys.writeFileString(file, "hello")
        expect(yield* fs.isFile(file)).toBe(true)
      }),
    )

    it(
      "returns false for directories",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        expect(yield* fs.isFile(tmp)).toBe(false)
      }),
    )
  })

  describe("readFileStringSafe", () => {
    it(
      "returns file contents when file exists",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "exists.txt")
        yield* filesys.writeFileString(file, "hello")

        const result = yield* fs.readFileStringSafe(file)
        expect(result).toBe("hello")
      }),
    )

    it(
      "returns undefined for missing file (NotFound)",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()

        const result = yield* fs.readFileStringSafe(path.join(tmp, "does-not-exist.txt"))
        expect(result).toBeUndefined()
      }),
    )
  })

  describe("readJson / writeJson", () => {
    it(
      "round-trips JSON data",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "data.json")
        const data = { name: "test", count: 42, nested: { ok: true } }

        yield* fs.writeJson(file, data)
        const result = yield* fs.readJson(file)

        expect(result).toEqual(data)
      }),
    )

    it(
      "fails invalid JSON through the error channel",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "broken.json")
        yield* filesys.writeFileString(file, "{")

        const result = yield* fs.readJson(file).pipe(Effect.catch((error) => Effect.succeed(error)))

        expect(result).toHaveProperty("_tag", "FileSystemError")
      }),
    )
  })

  describe("ensureDir", () => {
    it(
      "creates nested directories",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const nested = path.join(tmp, "a", "b", "c")

        yield* fs.ensureDir(nested)

        const info = yield* filesys.stat(nested)
        expect(info.type).toBe("Directory")
      }),
    )

    it(
      "is idempotent",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const dir = path.join(tmp, "existing")
        yield* filesys.makeDirectory(dir)

        yield* fs.ensureDir(dir)

        const info = yield* filesys.stat(dir)
        expect(info.type).toBe("Directory")
      }),
    )
  })

  describe("writeWithDirs", () => {
    it(
      "creates parent directories if missing",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "deep", "nested", "file.txt")

        yield* fs.writeWithDirs(file, "hello")

        expect(yield* filesys.readFileString(file)).toBe("hello")
      }),
    )

    it(
      "writes directly when parent exists",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "direct.txt")

        yield* fs.writeWithDirs(file, "world")

        expect(yield* filesys.readFileString(file)).toBe("world")
      }),
    )

    it(
      "writes Uint8Array content",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "binary.bin")
        const content = new Uint8Array([0x00, 0x01, 0x02, 0x03])

        yield* fs.writeWithDirs(file, content)

        const result = yield* filesys.readFile(file)
        expect(new Uint8Array(result)).toEqual(content)
      }),
    )
  })

  describe("findUp", () => {
    it(
      "finds target in start directory",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        yield* filesys.writeFileString(path.join(tmp, "target.txt"), "found")

        const result = yield* fs.findUp("target.txt", tmp)
        expect(result).toEqual([path.join(tmp, "target.txt")])
      }),
    )

    it(
      "finds target in parent directories",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        yield* filesys.writeFileString(path.join(tmp, "marker"), "root")
        const child = path.join(tmp, "a", "b")
        yield* filesys.makeDirectory(child, { recursive: true })

        const result = yield* fs.findUp("marker", child, tmp)
        expect(result).toEqual([path.join(tmp, "marker")])
      }),
    )

    it(
      "returns empty array when not found",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const result = yield* fs.findUp("nonexistent", tmp, tmp)
        expect(result).toEqual([])
      }),
    )
  })

  describe("up", () => {
    it(
      "finds multiple targets walking up",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        yield* filesys.writeFileString(path.join(tmp, "a.txt"), "a")
        yield* filesys.writeFileString(path.join(tmp, "b.txt"), "b")
        const child = path.join(tmp, "sub")
        yield* filesys.makeDirectory(child)
        yield* filesys.writeFileString(path.join(child, "a.txt"), "a-child")

        const result = yield* fs.up({ targets: ["a.txt", "b.txt"], start: child, stop: tmp })

        expect(result).toContain(path.join(child, "a.txt"))
        expect(result).toContain(path.join(tmp, "a.txt"))
        expect(result).toContain(path.join(tmp, "b.txt"))
      }),
    )

    it(
      "stops at the first match when requested",
      Effect.gen(function* () {
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        yield* filesys.writeFileString(path.join(tmp, "marker"), "root")
        const child = path.join(tmp, "sub")
        yield* filesys.makeDirectory(child)
        yield* filesys.writeFileString(path.join(child, "marker"), "child")
        const checked: string[] = []
        const instrumented = FileSystem.FileSystem.of({
          ...filesys,
          exists: (target) => Effect.sync(() => checked.push(target)).pipe(Effect.andThen(filesys.exists(target))),
        })
        const search = yield* FSUtil.Service.pipe(
          Effect.provide(
            FSUtil.layer.pipe(Layer.fresh, Layer.provide(Layer.succeed(FileSystem.FileSystem, instrumented))),
          ),
        )

        expect(yield* search.up({ targets: ["marker", "other"], start: child, mode: "first" })).toEqual([
          path.join(child, "marker"),
        ])
        expect(checked).toEqual([path.join(child, "marker")])
      }),
    )
  })

  describe("glob", () => {
    it(
      "finds files matching pattern",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        yield* filesys.writeFileString(path.join(tmp, "a.ts"), "a")
        yield* filesys.writeFileString(path.join(tmp, "b.ts"), "b")
        yield* filesys.writeFileString(path.join(tmp, "c.json"), "c")

        const result = yield* fs.scan("*.ts", { cwd: tmp })
        expect(result.sort()).toEqual(["a.ts", "b.ts"])
      }),
    )

    it(
      "supports absolute paths",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        yield* filesys.writeFileString(path.join(tmp, "file.txt"), "hello")

        const result = yield* fs.scan("*.txt", { cwd: tmp, absolute: true })
        expect(result).toEqual([path.join(tmp, "file.txt")])
      }),
    )
  })

  describe("globMatch", () => {
    it(
      "matches patterns",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
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
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        yield* filesys.writeFileString(path.join(tmp, "root.md"), "root")
        const child = path.join(tmp, "a", "b")
        yield* filesys.makeDirectory(child, { recursive: true })
        yield* filesys.writeFileString(path.join(child, "leaf.md"), "leaf")

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
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "exists.txt")
        yield* filesys.writeFileString(file, "yes")

        expect(yield* fs.exists(file)).toBe(true)
        expect(yield* fs.exists(file + ".nope")).toBe(false)
      }),
    )

    it(
      "remove works",
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const filesys = yield* FileSystem.FileSystem
        const tmp = yield* filesys.makeTempDirectoryScoped()
        const file = path.join(tmp, "delete-me.txt")
        yield* filesys.writeFileString(file, "bye")

        yield* fs.remove(file)

        expect(yield* fs.exists(file)).toBe(false)
      }),
    )
  })

  describe("pure helpers", () => {
    test("mimeType returns correct types", () => {
      expect(FSUtil.mimeType("file.json")).toBe("application/json")
      expect(FSUtil.mimeType("image.png")).toBe("image/png")
      expect(FSUtil.mimeType("unknown.qzx")).toBe("application/octet-stream")
    })

    test("contains checks path containment", () => {
      expect(FSUtil.contains("/a/b", "/a/b/c")).toBe(true)
      expect(FSUtil.contains("/a/b", "/a/b")).toBe(true)
      expect(FSUtil.contains("/a/b", "/a/c")).toBe(false)
      expect(FSUtil.contains("/a/b", "/a/bad")).toBe(false)
      if (process.platform === "win32") expect(FSUtil.contains("C:\\a", "D:\\b")).toBe(false)
    })

    test("overlaps detects overlapping paths", () => {
      expect(FSUtil.overlaps("/a/b", "/a/b/c")).toBe(true)
      expect(FSUtil.overlaps("/a/b/c", "/a/b")).toBe(true)
      expect(FSUtil.overlaps("/a", "/b")).toBe(false)
      expect(FSUtil.overlaps("/a/b", "/a/bad")).toBe(false)
      if (process.platform === "win32") expect(FSUtil.overlaps("C:\\a", "D:\\b")).toBe(false)
    })
  })
})

describe("FileSystem.find", () => {
  const searchLayer = Layer.succeed(
    FileSystemSearch.Service,
    FileSystemSearch.Service.of({ find: () => Effect.succeed([]) }),
  )

  const provide = (directory: string, search: Layer.Layer<FileSystemSearch.Service> = searchLayer) =>
    Effect.provide(
      LayerNode.compile(node, {
        replacements: [
          Location.node.replace(
            Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
            ),
          ),
          FileSystemSearch.node.replace(search),
        ],
      }),
    )

  const prepare = Effect.gen(function* () {
    const filesys = yield* FileSystem.FileSystem
    const tmp = yield* filesys.makeTempDirectoryScoped()
    yield* filesys.makeDirectory(path.join(tmp, "current"))
    yield* filesys.makeDirectory(path.join(tmp, "sibling", "sub"), { recursive: true })
    yield* filesys.writeFileString(path.join(tmp, "sibling", "alpha.txt"), "a")
    yield* filesys.writeFileString(path.join(tmp, "sibling", "beta.txt"), "b")
    yield* filesys.writeFileString(path.join(tmp, "sibling", ".secret.txt"), "s")
    yield* filesys.writeFileString(path.join(tmp, "sibling", "sub", "deep.txt"), "d")
    return tmp
  })

  it(
    "lists direct children of an absolute directory outside the location",
    prepare.pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const filesystem = yield* Service
          const entries = yield* filesystem.find({ query: "", path: path.join(tmp, "sibling") })
          expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("..", "sibling", "sub") + path.sep), type: "directory" },
            { path: RelativePath.make(path.join("..", "sibling", "alpha.txt")), type: "file" },
            { path: RelativePath.make(path.join("..", "sibling", "beta.txt")), type: "file" },
          ])
        }).pipe(provide(path.join(tmp, "current"))),
      ),
    ),
  )

  it(
    "accepts a relative path outside the location and honors the limit",
    prepare.pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const filesystem = yield* Service
          const sibling = yield* filesystem.find({ query: "", path: "../sibling" })
          const limited = yield* filesystem.find({ query: "", path: "../sibling", limit: 2 })
          expect(limited).toEqual(sibling.slice(0, 2))
        }).pipe(provide(path.join(tmp, "current"))),
      ),
    ),
  )

  it(
    "applies the type filter to direct children",
    prepare.pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const filesystem = yield* Service
          const files = yield* filesystem.find({ query: "", type: "file", path: path.join(tmp, "sibling") })
          expect(files.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("..", "sibling", "alpha.txt")), type: "file" },
            { path: RelativePath.make(path.join("..", "sibling", "beta.txt")), type: "file" },
          ])
          const directories = yield* filesystem.find({ query: "", type: "directory", path: "../sibling" })
          expect(directories.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("..", "sibling", "sub") + path.sep), type: "directory" },
          ])
        }).pipe(provide(path.join(tmp, "current"))),
      ),
    ),
  )

  it(
    "hides dot entries unless the fragment opts into them",
    prepare.pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const filesystem = yield* Service
          expect(yield* filesystem.find({ query: "secret", path: "../sibling" })).toEqual([])
          const visible = yield* filesystem.find({ query: ".secret", path: "../sibling" })
          expect(visible.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("..", "sibling", ".secret.txt")), type: "file" },
          ])
        }).pipe(provide(path.join(tmp, "current"))),
      ),
    ),
  )

  it(
    "fuzzy-ranks direct children by basename",
    prepare.pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const filesystem = yield* Service
          const entries = yield* filesystem.find({ query: "lpha", path: "../sibling" })
          expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("..", "sibling", "alpha.txt")), type: "file" },
          ])
        }).pipe(provide(path.join(tmp, "current"))),
      ),
    ),
  )

  it(
    "returns empty results for a missing or non-directory base",
    prepare.pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const filesys = yield* FileSystem.FileSystem
          yield* filesys.writeFileString(path.join(tmp, "plain.txt"), "not a directory")
          const filesystem = yield* Service
          expect(yield* filesystem.find({ query: "", path: path.join(tmp, "missing") })).toEqual([])
          expect(yield* filesystem.find({ query: "", path: path.join(tmp, "plain.txt") })).toEqual([])
        }).pipe(provide(path.join(tmp, "current"))),
      ),
    ),
  )

  it(
    "expands a `~/`-prefixed path to the server home",
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const home = yield* filesys.makeTempDirectoryScoped()
      yield* filesys.makeDirectory(path.join(home, "project"))
      yield* filesys.makeDirectory(path.join(home, "remotedir"))
      yield* filesys.writeFileString(path.join(home, "remotedir", "homefile.txt"), "h")
      yield* filesys.writeFileString(path.join(home, "project", "inside.txt"), "i")
      const spy = spyOn(os, "homedir").mockReturnValue(home)
      yield* Effect.gen(function* () {
        const filesystem = yield* Service
        const entries = yield* filesystem.find({ query: "homefile", path: "~/remotedir" })
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make(path.join("..", "remotedir", "homefile.txt")), type: "file" },
        ])
        const inside = yield* filesystem.find({ query: "inside", path: "~/project" })
        expect(inside.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("inside.txt"), type: "file" },
        ])
      }).pipe(
        Effect.ensuring(Effect.sync(() => spy.mockRestore())),
        provide(path.join(home, "project")),
      )
    }),
  )

  it(
    "applies direct-children semantics to a provided path inside the location",
    Effect.gen(function* () {
      let observed: FindInput | undefined
      const recorded = Layer.succeed(
        FileSystemSearch.Service,
        FileSystemSearch.Service.of({
          find: (input) => {
            observed = input
            return Effect.succeed([])
          },
        }),
      )
      const tmp = yield* prepare
      const filesys = yield* FileSystem.FileSystem
      yield* filesys.writeFileString(path.join(tmp, "current", "here.txt"), "h")
      yield* filesys.makeDirectory(path.join(tmp, "current", "nested"))
      yield* Effect.gen(function* () {
        const filesystem = yield* Service
        const entries = yield* filesystem.find({ query: "", path: "." })
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("nested" + path.sep), type: "directory" },
          { path: RelativePath.make("here.txt"), type: "file" },
        ])
        observed = undefined
        const outside = yield* filesystem.find({ query: "", path: "../sibling" })
        expect(observed).toBeUndefined()
        expect(outside.length).toBe(3)
      }).pipe(Effect.scoped, provide(path.join(tmp, "current"), recorded))
    }),
  )

  it(
    "delegates searches without a path to the index service",
    Effect.gen(function* () {
      let observed: FindInput | undefined
      const recorded = Layer.succeed(
        FileSystemSearch.Service,
        FileSystemSearch.Service.of({
          find: (input) => {
            observed = input
            return Effect.succeed([])
          },
        }),
      )
      const tmp = yield* prepare
      yield* Effect.gen(function* () {
        const filesystem = yield* Service
        expect(yield* filesystem.find({ query: "fragment" })).toEqual([])
        expect(observed?.query).toBe("fragment")
        expect(observed?.path).toBeUndefined()
      }).pipe(Effect.scoped, provide(path.join(tmp, "current"), recorded))
    }),
  )
})
