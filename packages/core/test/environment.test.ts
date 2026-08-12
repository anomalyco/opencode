import fs from "node:fs/promises"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { EnvironmentUnavailable } from "../src/environment/unavailable"
import {
  execDefaults,
  Failed,
  makeFiles,
  makeLocalDriver,
  makeMemoryDriver,
  NotFound,
  typeFollowing,
} from "../src/environment/index"
import { tmpdir } from "./fixture/tmpdir"
import { environmentConformance } from "./lib/environment-conformance"
import { it } from "./lib/effect"

describe("typeFollowing", () => {
  it.effect("follows symlinks without changing stat semantics", () =>
    Effect.gen(function* () {
      const driver = makeMemoryDriver()
      const files = makeFiles(driver)
      yield* files.mkdir("/directory")
      yield* files.write("/file", new Uint8Array())
      yield* driver.symlink("/directory", "/directory-link")
      yield* driver.symlink("/file", "/file-link")
      yield* driver.symlink("/missing", "/dangling-link")

      expect(yield* typeFollowing(files, "/directory-link")).toBe("directory")
      expect(yield* typeFollowing(files, "/file-link")).toBe("file")
      expect(yield* typeFollowing(files, "/dangling-link").pipe(Effect.flip)).toBeInstanceOf(NotFound)
    }),
  )
})

describe("no execution plane", () => {
  it.effect("fails spawn with a typed location error", () =>
    Effect.gen(function* () {
      const error = yield* EnvironmentUnavailable.spawner
        .spawn(ChildProcess.make("echo", ["hello"]))
        .pipe(Effect.flip)

      expect(error._tag).toBe("PlatformError")
      expect(error.message).toContain("location has no execution plane")
    }),
  )
})

environmentConformance("memory environment", () =>
  Effect.sync(() => {
    const driver = makeMemoryDriver()
    return {
      files: makeFiles(driver),
      root: `/workspace-${crypto.randomUUID()}`,
      symlink: driver.symlink,
    }
  }),
)

environmentConformance("local environment", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const tmp = yield* Effect.promise(() => tmpdir("opencode-local-environment-"))
    return {
      files: makeFiles(makeLocalDriver(spawner)),
      root: tmp.path,
      ...(process.platform === "win32"
        ? {}
        : {
            symlink: (target: string, link: string) =>
              Effect.tryPromise({
                try: () => fs.symlink(target, link),
                catch: (cause) => new Failed({ path: link, cause }),
              }),
          }),
      dispose: Effect.promise(() => tmp[Symbol.asyncDispose]()),
    }
  }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
)

environmentConformance(
  "GNU exec environment",
  () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const tmp = yield* Effect.promise(() => tmpdir("opencode-environment-"))
      return {
        files: execDefaults(spawner),
        root: tmp.path,
        symlink: (target: string, link: string) =>
          Effect.tryPromise({
            try: () => fs.symlink(target, link),
            catch: (cause) => new Failed({ path: link, cause }),
          }),
        dispose: Effect.promise(() => tmp[Symbol.asyncDispose]()),
      }
    }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
  process.platform !== "linux",
)
