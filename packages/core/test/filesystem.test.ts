import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Exit, Layer, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"

const workspaceID = WorkspaceV2.ID.make("wrk_fs_test")

let tmp = ""
const ref = { directory: AbsolutePath.make("/tmp/opencode-fs-placeholder"), workspaceID }

const projectLayer = Layer.succeed(
  Project.Service,
  Project.Service.of({
    directories: () => Effect.succeed([]),
    resolve: () =>
      Effect.succeed({
        id: Project.ID.make("project"),
        directory: AbsolutePath.make(tmp),
        vcs: { type: "git", store: AbsolutePath.make(path.join(tmp, ".git")) },
      }),
    commit: () => Effect.void,
  }),
)

const searchStub = Layer.succeed(
  FileSystemSearch.Service,
  FileSystemSearch.Service.of({
    find: () => Effect.succeed([]),
    glob: () => Effect.succeed([]),
    grep: () => Effect.succeed([]),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(FileSystem.node, [
    [Location.node, Location.boundNode(ref)],
    [Project.node, projectLayer],
    [FileSystemSearch.node, searchStub],
  ]).pipe(Layer.provide(NodeFileSystem.layer)),
)

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-fs-"))
  ref.directory = AbsolutePath.make(tmp)
  await writeFile(path.join(tmp, "a.txt"), "hello")
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("FSUtil.contains", () => {
  test("accepts paths nested inside the parent", () => {
    expect(FSUtil.contains("/repo", "/repo")).toBe(true)
    expect(FSUtil.contains("/repo", "/repo/a/b.txt")).toBe(true)
  })

  test("rejects paths that escape the parent", () => {
    expect(FSUtil.contains("/repo", "/repo/../outside.txt")).toBe(false)
    expect(FSUtil.contains("/repo", "/other")).toBe(false)
    expect(FSUtil.contains("/repo", "/repo2/a.txt")).toBe(false)
  })
})

describe("FileSystem.write", () => {
  it.effect("writes files into new nested directories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      yield* fs.write({ path: "new/dir/file.txt", content: new TextEncoder().encode("hello") })
      const file = yield* fs.read({ path: RelativePath.make("new/dir/file.txt") })
      expect(new TextDecoder().decode(file.content)).toBe("hello")
    }),
  )

  it.effect("overwrites existing files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      yield* fs.write({ path: "a.txt", content: new TextEncoder().encode("updated") })
      const file = yield* fs.read({ path: RelativePath.make("a.txt") })
      expect(new TextDecoder().decode(file.content)).toBe("updated")
    }),
  )

  it.effect("rejects paths that escape the location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      const exit = yield* fs.write({ path: "../escape.txt", content: new Uint8Array([1]) }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("writeStream streams chunks into new nested directories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      const chunks = ["chunk-", "one-", "two"].map((part) => new TextEncoder().encode(part))
      yield* fs.writeStream({ path: "nested/deep/file.txt", stream: Stream.fromIterable(chunks) })
      const file = yield* fs.read({ path: RelativePath.make("nested/deep/file.txt") })
      expect(new TextDecoder().decode(file.content)).toBe("chunk-one-two")
    }),
  )

  it.effect("writeStream rejects paths that escape the location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      const exit = yield* fs
        .writeStream({ path: "../escape.bin", stream: Stream.fromIterable([new Uint8Array([1])]) })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("writeStream removes the partial file when the stream fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      const failing = Stream.concat(
        Stream.fromIterable([new TextEncoder().encode("partial")]),
        Stream.fail(new Error("stream aborted")),
      )
      const exit = yield* fs.writeStream({ path: "broken.bin", stream: failing }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      const readExit = yield* fs.read({ path: RelativePath.make("broken.bin") }).pipe(Effect.exit)
      expect(Exit.isFailure(readExit)).toBe(true)
    }),
  )

  it.effect("writeStream preserves an existing file when the stream fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      yield* fs.write({ path: "keep.txt", content: new TextEncoder().encode("original") })
      const failing = Stream.concat(
        Stream.fromIterable([new TextEncoder().encode("partial")]),
        Stream.fail(new Error("stream aborted")),
      )
      const exit = yield* fs.writeStream({ path: "keep.txt", stream: failing }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      const file = yield* fs.read({ path: RelativePath.make("keep.txt") })
      expect(new TextDecoder().decode(file.content)).toBe("original")
    }),
  )
})

describe("FileSystem.remove", () => {
  it.effect("rejects deleting the location root via empty or dot path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      const empty = yield* fs.remove({ path: "" }).pipe(Effect.exit)
      expect(Exit.isFailure(empty)).toBe(true)
      const dot = yield* fs.remove({ path: "." }).pipe(Effect.exit)
      expect(Exit.isFailure(dot)).toBe(true)
    }),
  )

  it.effect("rejects deleting paths that escape the location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      const exit = yield* fs.remove({ path: "../escape" }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("removes files and directories recursively within the location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      yield* fs.write({ path: "sub/deep.txt", content: new Uint8Array([1, 2, 3]) })
      yield* fs.remove({ path: "sub" })
      const exit = yield* fs.read({ path: RelativePath.make("sub/deep.txt") }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("ignores removing a path that does not exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      yield* fs.remove({ path: "does-not-exist.txt" })
    }),
  )
})

describe("FileSystem.read", () => {
  it.effect("rejects paths that escape the location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.Service
      const exit = yield* fs.read({ path: RelativePath.make("../outside") }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
