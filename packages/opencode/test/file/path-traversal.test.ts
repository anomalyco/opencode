import { expect, describe } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "@/util/filesystem"
import { File } from "../../src/file"
import { InstanceState } from "../../src/effect/instance-state"
import { containsPath } from "../../src/project/instance-context"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(File.defaultLayer)
const read = (file: string) => File.Service.use((svc) => svc.read(file))
const list = (dir?: string) => File.Service.use((svc) => svc.list(dir))
const expectAccessDenied = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit)
    if (Exit.isSuccess(exit)) throw new Error("expected access denied")
    expect(Cause.squash(exit.cause)).toHaveProperty("message", "Access denied: path escapes project directory")
  })

describe("Filesystem.contains", () => {
  it.effect("allows paths within project", () =>
    Effect.sync(() => {
      expect(Filesystem.contains("/project", "/project/src")).toBe(true)
      expect(Filesystem.contains("/project", "/project/src/file.ts")).toBe(true)
      expect(Filesystem.contains("/project", "/project")).toBe(true)
    }),
  )

  it.effect("blocks ../ traversal", () =>
    Effect.sync(() => {
      expect(Filesystem.contains("/project", "/project/../etc")).toBe(false)
      expect(Filesystem.contains("/project", "/project/src/../../etc")).toBe(false)
      expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
    }),
  )

  it.effect("blocks absolute paths outside project", () =>
    Effect.sync(() => {
      expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
      expect(Filesystem.contains("/project", "/tmp/file")).toBe(false)
      expect(Filesystem.contains("/home/user/project", "/home/user/other")).toBe(false)
    }),
  )

  it.effect("handles prefix collision edge cases", () =>
    Effect.sync(() => {
      expect(Filesystem.contains("/project", "/project-other/file")).toBe(false)
      expect(Filesystem.contains("/project", "/projectfile")).toBe(false)
    }),
  )
})

/*
 * Integration tests for read() and list() path traversal protection.
 *
 * These tests verify the HTTP API code path is protected. The HTTP endpoints
 * in server.ts (GET /file/content, GET /file) call read()/list()
 * directly - they do NOT go through ReadTool or the agent permission layer.
 *
 * This is a SEPARATE code path from ReadTool, which has its own checks.
 */
describe("File.read path traversal protection", () => {
  it.instance("rejects ../ traversal attempting to read /etc/passwd", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "allowed.txt"), "allowed content"))
      yield* expectAccessDenied(read("../../../etc/passwd"))
    }),
  )

  it.instance("rejects deeply nested traversal", () =>
    Effect.gen(function* () {
      yield* expectAccessDenied(read("src/nested/../../../../../../../etc/passwd"))
    }),
  )

  it.instance("allows valid paths within project", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "valid.txt"), "valid content"))

      const result = yield* read("valid.txt")
      expect(result.content).toBe("valid content")
    }),
  )
})

describe("File.list path traversal protection", () => {
  it.instance("rejects ../ traversal attempting to list /etc", () =>
    Effect.gen(function* () {
      yield* expectAccessDenied(list("../../../etc"))
    }),
  )

  it.instance("allows valid subdirectory listing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "subdir", "file.txt"), "content"))

      const result = yield* list("subdir")
      expect(Array.isArray(result)).toBe(true)
    }),
  )
})

describe("containsPath", () => {
  it.instance(
    "returns true for path inside directory",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const ctx = yield* InstanceState.context
        expect(containsPath(path.join(test.directory, "foo.txt"), ctx)).toBe(true)
        expect(containsPath(path.join(test.directory, "src", "file.ts"), ctx)).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "returns true for path inside worktree but outside directory (monorepo subdirectory scenario)",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const subdir = path.join(test.directory, "packages", "lib")
        yield* Effect.promise(() => fs.mkdir(subdir, { recursive: true }))
        const ctx = { ...(yield* InstanceState.context), directory: subdir }

        // .opencode at worktree root, but we're running from packages/lib
        expect(containsPath(path.join(test.directory, ".opencode", "state"), ctx)).toBe(true)
        // sibling package should also be accessible
        expect(containsPath(path.join(test.directory, "packages", "other", "file.ts"), ctx)).toBe(true)
        // worktree root itself
        expect(containsPath(test.directory, ctx)).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "returns false for path outside both directory and worktree",
    () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        expect(containsPath("/etc/passwd", ctx)).toBe(false)
        expect(containsPath("/tmp/other-project", ctx)).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "returns false for path with .. escaping worktree",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const ctx = yield* InstanceState.context
        expect(containsPath(path.join(test.directory, "..", "escape.txt"), ctx)).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "handles directory === worktree (running from repo root)",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const ctx = yield* InstanceState.context
        expect(ctx.directory).toBe(ctx.worktree)
        expect(containsPath(path.join(test.directory, "file.txt"), ctx)).toBe(true)
        expect(containsPath("/etc/passwd", ctx)).toBe(false)
      }),
    { git: true },
  )

  it.instance("non-git project does not allow arbitrary paths via worktree='/'", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const ctx = yield* InstanceState.context
      // worktree is "/" for non-git projects, but containsPath should NOT allow all paths
      expect(containsPath(path.join(test.directory, "file.txt"), ctx)).toBe(true)
      expect(containsPath("/etc/passwd", ctx)).toBe(false)
      expect(containsPath("/tmp/other", ctx)).toBe(false)
    }),
  )
})
