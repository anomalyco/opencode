import { describe, expect } from "bun:test"
import { Effect, Layer, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import path from "path"
import * as fs from "fs/promises"
import os from "os"
import { WorktreeInclude } from "../../src/worktree/include"
import { testEffect } from "../lib/effect"

const live = Layer.mergeAll(AppFileSystem.layer.pipe(Layer.provide(NodeFileSystem.layer)), NodePath.layer)
const { effect: it } = testEffect(live)

async function makeTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-worktreeinclude-"))
}

async function write(dir: string, rel: string, content: string) {
  const full = path.join(dir, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content)
}

async function exists(p: string) {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

describe("WorktreeInclude.apply", () => {
  it(
    "is a no-op when .worktreeinclude is missing",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      yield* Effect.promise(() => write(source, ".env", "SECRET=1"))

      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })
      expect(result.copied).toEqual([])
      expect(result.failed).toEqual([])
      expect(yield* Effect.promise(() => exists(path.join(destination, ".env")))).toBe(false)

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )

  it(
    "is a no-op when .worktreeinclude is empty / whitespace",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      yield* Effect.promise(() => write(source, ".worktreeinclude", "   \n\n"))
      yield* Effect.promise(() => write(source, ".env", "SECRET=1"))

      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })
      expect(result.copied).toEqual([])
      expect(yield* Effect.promise(() => exists(path.join(destination, ".env")))).toBe(false)

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )

  it(
    "copies matching files and creates parent directories",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      yield* Effect.promise(() => write(source, ".worktreeinclude", ".env\n.env.local\nconfig/secrets.json\n"))
      yield* Effect.promise(() => write(source, ".env", "A=1"))
      yield* Effect.promise(() => write(source, ".env.local", "B=2"))
      yield* Effect.promise(() => write(source, "config/secrets.json", '{"k":"v"}'))
      yield* Effect.promise(() => write(source, "README.md", "should not copy"))

      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })

      expect(result.failed).toEqual([])
      expect(result.copied.sort()).toEqual([".env", ".env.local", "config/secrets.json"].sort())

      expect(yield* Effect.promise(() => fs.readFile(path.join(destination, ".env"), "utf8"))).toBe("A=1")
      expect(yield* Effect.promise(() => fs.readFile(path.join(destination, ".env.local"), "utf8"))).toBe("B=2")
      expect(yield* Effect.promise(() => fs.readFile(path.join(destination, "config/secrets.json"), "utf8"))).toBe(
        '{"k":"v"}',
      )
      expect(yield* Effect.promise(() => exists(path.join(destination, "README.md")))).toBe(false)

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )

  it(
    "copies an entire matched directory recursively",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      yield* Effect.promise(() => write(source, ".worktreeinclude", ".secrets/\n"))
      yield* Effect.promise(() => write(source, ".secrets/a.txt", "a"))
      yield* Effect.promise(() => write(source, ".secrets/nested/b.txt", "b"))

      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })
      expect(result.failed).toEqual([])
      expect(result.copied).toContain(".secrets")

      expect(yield* Effect.promise(() => exists(path.join(destination, ".secrets")))).toBe(true)
      expect(yield* Effect.promise(() => fs.readFile(path.join(destination, ".secrets/a.txt"), "utf8"))).toBe("a")
      expect(yield* Effect.promise(() => fs.readFile(path.join(destination, ".secrets/nested/b.txt"), "utf8"))).toBe(
        "b",
      )

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )

  it(
    "honours negation patterns",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      yield* Effect.promise(() => write(source, ".worktreeinclude", ".env*\n!.env.public\n"))
      yield* Effect.promise(() => write(source, ".env", "S=1"))
      yield* Effect.promise(() => write(source, ".env.local", "S=2"))
      yield* Effect.promise(() => write(source, ".env.public", "P=3"))

      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })

      expect(result.failed).toEqual([])
      expect(result.copied.sort()).toEqual([".env", ".env.local"].sort())
      expect(yield* Effect.promise(() => exists(path.join(destination, ".env.public")))).toBe(false)

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )

  it(
    "skips the .git directory entirely",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      yield* Effect.promise(() => write(source, ".worktreeinclude", "**\n"))
      yield* Effect.promise(() => write(source, ".git/HEAD", "ref"))
      yield* Effect.promise(() => write(source, "keep.txt", "ok"))

      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })

      expect(result.copied).not.toContain(".git")
      expect(result.copied).not.toContain(".git/HEAD")
      expect(yield* Effect.promise(() => exists(path.join(destination, ".git")))).toBe(false)

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )

  it(
    "does not descend into standard build directories like node_modules",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      yield* Effect.promise(() => write(source, ".worktreeinclude", ".env\n"))
      yield* Effect.promise(() => write(source, ".env", "SECRET=1"))
      // Make a node_modules with a sentinel that would be picked up if walk
      // descended into it AND the matcher was permissive enough.
      yield* Effect.promise(() => write(source, "node_modules/foo/.env", "leaked"))
      yield* Effect.promise(() => write(source, "node_modules/foo/index.js", "x"))
      yield* Effect.promise(() => write(source, "dist/.env", "leaked"))

      const start = Date.now()
      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })
      const elapsed = Date.now() - start

      expect(result.failed).toEqual([])
      expect(result.copied).toEqual([".env"])
      expect(yield* Effect.promise(() => exists(path.join(destination, "node_modules")))).toBe(false)
      expect(yield* Effect.promise(() => exists(path.join(destination, "dist")))).toBe(false)
      // Sanity: pruning should keep this fast even with junk inside skipped dirs.
      expect(elapsed).toBeLessThan(2000)

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )

  it(
    "lets users explicitly include otherwise-pruned directories",
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const source = yield* Effect.promise(() => makeTmp())
      const destination = yield* Effect.promise(() => makeTmp())
      // `vendor` is in the standard prune list. Listing it explicitly should
      // still result in it being copied wholesale.
      yield* Effect.promise(() => write(source, ".worktreeinclude", "vendor/\n"))
      yield* Effect.promise(() => write(source, "vendor/lib.js", "v"))
      yield* Effect.promise(() => write(source, "vendor/inner/extra.js", "e"))

      const result = yield* WorktreeInclude.apply({ source, destination, fs: appFs, pathSvc })

      expect(result.failed).toEqual([])
      expect(result.copied).toContain("vendor")
      expect(yield* Effect.promise(() => fs.readFile(path.join(destination, "vendor/lib.js"), "utf8"))).toBe("v")
      expect(yield* Effect.promise(() => fs.readFile(path.join(destination, "vendor/inner/extra.js"), "utf8"))).toBe(
        "e",
      )

      yield* Effect.promise(() => fs.rm(source, { recursive: true, force: true }))
      yield* Effect.promise(() => fs.rm(destination, { recursive: true, force: true }))
    }),
  )
})
