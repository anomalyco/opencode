import fs from "node:fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { EnvironmentUnavailable } from "../src/environment/unavailable"
import { Ripgrep } from "../src/ripgrep"
import { RipgrepBinary } from "../src/ripgrep/binary"
import { Workspace } from "../src/workspace"
import {
  Environment,
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
      const error = yield* EnvironmentUnavailable.spawner.spawn(ChildProcess.make("echo", ["hello"])).pipe(Effect.flip)

      expect(error._tag).toBe("PlatformError")
      expect(error.message).toContain("location has no execution plane")
    }),
  )

  it.effect("omits local and search capabilities when local has no execution plane", () =>
    Effect.sync(() => {
      const unavailable = Environment.local(EnvironmentUnavailable.spawner)
      expect(unavailable.local).toBe(false)
      expect(unavailable.rg).toBeUndefined()
      expect(unavailable.home).toBeUndefined()
    }),
  )
})

describe("ripgrep environment", () => {
  it.effect("uses environment.rg instead of the host binary path on remote workspaces", () =>
    Effect.gen(function* () {
      const spawned: ChildProcess.Command[] = []
      const remote = Environment.workspace(Workspace.ID.make("wrk_rg_test"), {
        spawner: ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            spawned.push(command)
            return makeHandle({
              pid: ProcessId(1),
              exitCode: Effect.succeed(ExitCode(1)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            })
          }),
        ),
      })
      const layer = AppNodeBuilder.build(Ripgrep.node, [
        RipgrepBinary.node.replace(
          Layer.succeed(RipgrepBinary.Service, RipgrepBinary.Service.of({ filepath: Effect.succeed("/host/bin/rg") })),
        ),
      ])
      const matches = yield* Effect.flatMap(Ripgrep.Service, (rg) =>
        rg.grep({ environment: remote, cwd: "/workspace", pattern: "needle", limit: 10 }),
      ).pipe(Effect.provide(layer))
      expect(matches).toEqual([])
      expect(spawned).toHaveLength(1)
      expect(ChildProcess.isStandardCommand(spawned[0]) && spawned[0].command).toBe("rg")
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
