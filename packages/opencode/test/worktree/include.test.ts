import { describe, expect } from "bun:test"
import { Effect, Layer, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import path from "path"
import * as fsp from "fs/promises"
import { WorktreeInclude } from "../../src/worktree/include"
import { testEffect } from "../lib/effect"

const live = Layer.mergeAll(AppFileSystem.layer.pipe(Layer.provide(NodeFileSystem.layer)), NodePath.layer)
const { effect: it } = testEffect(live)

const setup = Effect.fn(function* () {
  const fs = yield* AppFileSystem.Service
  const pathSvc = yield* Path.Path
  // Scoped temp dirs are removed automatically when the test scope ends.
  const source = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-worktreeinclude-src-" })
  const destination = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-worktreeinclude-dst-" })

  const write = (rel: string, content: string) =>
    Effect.promise(async () => {
      const full = path.join(source, rel)
      await fsp.mkdir(path.dirname(full), { recursive: true })
      await fsp.writeFile(full, content)
    })

  const exists = (rel: string) =>
    Effect.promise(async () => {
      try {
        await fsp.stat(path.join(destination, rel))
        return true
      } catch {
        return false
      }
    })

  const read = (rel: string) => Effect.promise(() => fsp.readFile(path.join(destination, rel), "utf8"))

  const apply = () => WorktreeInclude.apply({ source, destination, fs, pathSvc })

  return { source, destination, write, exists, read, apply }
})

describe("WorktreeInclude.apply", () => {
  it(
    "is a no-op when .worktreeinclude is missing",
    Effect.gen(function* () {
      const t = yield* setup()
      yield* t.write(".env", "SECRET=1")

      const result = yield* t.apply()
      expect(result.copied).toEqual([])
      expect(result.failed).toEqual([])
      expect(yield* t.exists(".env")).toBe(false)
    }),
  )

  it(
    "is a no-op when .worktreeinclude is empty / whitespace",
    Effect.gen(function* () {
      const t = yield* setup()
      yield* t.write(".worktreeinclude", "   \n\n")
      yield* t.write(".env", "SECRET=1")

      const result = yield* t.apply()
      expect(result.copied).toEqual([])
      expect(yield* t.exists(".env")).toBe(false)
    }),
  )

  it(
    "copies matching files and creates parent directories",
    Effect.gen(function* () {
      const t = yield* setup()
      yield* t.write(".worktreeinclude", ".env\n.env.local\nconfig/secrets.json\n")
      yield* t.write(".env", "A=1")
      yield* t.write(".env.local", "B=2")
      yield* t.write("config/secrets.json", '{"k":"v"}')
      yield* t.write("README.md", "should not copy")

      const result = yield* t.apply()
      expect(result.failed).toEqual([])
      expect(result.copied.sort()).toEqual([".env", ".env.local", "config/secrets.json"].sort())
      expect(yield* t.read(".env")).toBe("A=1")
      expect(yield* t.read(".env.local")).toBe("B=2")
      expect(yield* t.read("config/secrets.json")).toBe('{"k":"v"}')
      expect(yield* t.exists("README.md")).toBe(false)
    }),
  )

  it(
    "copies an entire matched directory recursively",
    Effect.gen(function* () {
      const t = yield* setup()
      yield* t.write(".worktreeinclude", ".secrets/\n")
      yield* t.write(".secrets/a.txt", "a")
      yield* t.write(".secrets/nested/b.txt", "b")

      const result = yield* t.apply()
      expect(result.failed).toEqual([])
      expect(result.copied).toContain(".secrets")
      expect(yield* t.exists(".secrets")).toBe(true)
      expect(yield* t.read(".secrets/a.txt")).toBe("a")
      expect(yield* t.read(".secrets/nested/b.txt")).toBe("b")
    }),
  )

  it(
    "honours negation patterns",
    Effect.gen(function* () {
      const t = yield* setup()
      yield* t.write(".worktreeinclude", ".env*\n!.env.public\n")
      yield* t.write(".env", "S=1")
      yield* t.write(".env.local", "S=2")
      yield* t.write(".env.public", "P=3")

      const result = yield* t.apply()
      expect(result.failed).toEqual([])
      expect(result.copied.sort()).toEqual([".env", ".env.local"].sort())
      expect(yield* t.exists(".env.public")).toBe(false)
    }),
  )

  it(
    "skips the .git directory entirely",
    Effect.gen(function* () {
      const t = yield* setup()
      yield* t.write(".worktreeinclude", "**\n")
      yield* t.write(".git/HEAD", "ref")
      yield* t.write("keep.txt", "ok")

      const result = yield* t.apply()
      expect(result.copied).not.toContain(".git")
      expect(result.copied).not.toContain(".git/HEAD")
      expect(yield* t.exists(".git")).toBe(false)
    }),
  )

  it(
    "does not descend into standard build directories like node_modules",
    Effect.gen(function* () {
      const t = yield* setup()
      yield* t.write(".worktreeinclude", ".env\n")
      yield* t.write(".env", "SECRET=1")
      // Make a node_modules with a sentinel that would be picked up if walk
      // descended into it AND the matcher was permissive enough.
      yield* t.write("node_modules/foo/.env", "leaked")
      yield* t.write("node_modules/foo/index.js", "x")
      yield* t.write("dist/.env", "leaked")

      const start = Date.now()
      const result = yield* t.apply()
      const elapsed = Date.now() - start

      expect(result.failed).toEqual([])
      expect(result.copied).toEqual([".env"])
      expect(yield* t.exists("node_modules")).toBe(false)
      expect(yield* t.exists("dist")).toBe(false)
      // Sanity: pruning should keep this fast even with junk inside skipped dirs.
      expect(elapsed).toBeLessThan(2000)
    }),
  )

  it(
    "lets users explicitly include otherwise-pruned directories",
    Effect.gen(function* () {
      const t = yield* setup()
      // `vendor` is in the standard prune list. Listing it explicitly should
      // still result in it being copied wholesale.
      yield* t.write(".worktreeinclude", "vendor/\n")
      yield* t.write("vendor/lib.js", "v")
      yield* t.write("vendor/inner/extra.js", "e")

      const result = yield* t.apply()
      expect(result.failed).toEqual([])
      expect(result.copied).toContain("vendor")
      expect(yield* t.read("vendor/lib.js")).toBe("v")
      expect(yield* t.read("vendor/inner/extra.js")).toBe("e")
    }),
  )
})
