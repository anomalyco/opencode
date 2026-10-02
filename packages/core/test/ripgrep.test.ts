import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Layer, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { AppProcess } from "@opencode-ai/core/process"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

describe("Ripgrep", () => {
  it.live("keeps ignored files out of catch-all find results", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true }))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
          yield* Effect.promise(() => Bun.$`git init -q ${tmp.path}`)
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".gitignore"), "node_modules/\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "node_modules", "pkg", "index.js"), "ignored\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "index.js"), "included\n"))

          const files = yield* (yield* Ripgrep.Service).find({ cwd: tmp.path, pattern: "*", limit: 10 })
          expect(files.map((item) => item.path)).toContain(RelativePath.make("src/index.js"))
          expect(files.map((item) => item.path)).not.toContain(RelativePath.make("node_modules/pkg/index.js"))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("never includes git metadata", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".opencode")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".opencode", "config"), "needle\n"))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".git")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".git", "config"), "needle\n"))
          const ripgrep = yield* Ripgrep.Service

          const files = yield* ripgrep.find({ cwd: tmp.path, pattern: "**/*", limit: 10 })
          expect(files.map((item) => item.path)).toContain(RelativePath.make(".opencode/config"))
          expect(files.map((item) => item.path)).not.toContain(RelativePath.make(".git/config"))

          const observed: string[] = []
          const limited = yield* ripgrep.find({
            cwd: tmp.path,
            pattern: "**/*",
            limit: 1,
            onEntry: (entry) => Effect.sync(() => observed.push(entry.path)),
          })
          expect(observed).toEqual(limited.map((item) => item.path))

          const matches = yield* ripgrep.grep({ cwd: tmp.path, pattern: "needle", include: "config", limit: 10 })
          expect(matches.map((item) => item.entry.path)).toContain(RelativePath.make(".opencode/config"))
          expect(matches.map((item) => item.entry.path)).not.toContain(RelativePath.make(".git/config"))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
  it.live("does not split surrogate pairs in oversized line previews", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(path.join(tmp.path, "unicode.txt"), `needle${"x".repeat(1_993)}😀\n`),
          )

          const matches = yield* (yield* Ripgrep.Service).grep({
            cwd: tmp.path,
            pattern: "needle",
            limit: 10,
          })

          expect(matches[0]?.text).toBe(`needle${"x".repeat(1_993)}...`)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

const encoder = new TextEncoder()

const fakeHandle = (options: { stdout?: Stream.Stream<Uint8Array>; stderr?: string; code: number }) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(0),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
    stdout: options.stdout ?? Stream.empty,
    stderr:
      options.stderr === undefined ? Stream.empty : Stream.make(encoder.encode(options.stderr)),
    all: Stream.empty,
    getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  })

const fakeBinary = Layer.succeed(
  RipgrepBinary.Service,
  RipgrepBinary.Service.of({ filepath: Effect.succeed("/fake/rg") }),
)

const mockedIt = (spawn: (command: unknown) => Effect.Effect<any, any, any>) =>
  testEffect(
    AppNodeBuilder.build(Ripgrep.node, [
      [AppProcess.node, Layer.mock(AppProcess.Service, { spawn: spawn as any })],
      [RipgrepBinary.node, fakeBinary],
    ]),
  )

describe("Ripgrep failures", () => {
  const failingAllocation = mockedIt(() =>
    Effect.succeed(
      fakeHandle({ code: 2, stderr: "memory allocation of 134217728 bytes failed\n" }),
    ),
  )

  failingAllocation.effect("fails fast on allocation/commit-limit failures instead of partial success", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const exit = yield* ripgrep.grep({ cwd: "/tmp", pattern: "needle", limit: 10 }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(String((error as Error).message)).toMatch(/allocation|failed with code 2/i)
      }
    }),
  )

  const invalidPattern = mockedIt(() =>
    Effect.succeed(fakeHandle({ code: 2, stderr: "regex parse error:\n([: unclosed group\n" })),
  )

  invalidPattern.effect("keeps invalid patterns as InvalidPatternError", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const exit = yield* ripgrep.grep({ cwd: "/tmp", pattern: "([", limit: 10 }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(Ripgrep.InvalidPatternError)
      }
    }),
  )

  const spawnFailure = mockedIt(() => Effect.fail(new Error("spawn ENOMEM")))
  spawnFailure.effect("surfaces spawn failures as Ripgrep.Error", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const exit = yield* ripgrep.grep({ cwd: "/tmp", pattern: "needle", limit: 10 }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(Ripgrep.Error)
      }
    }),
  )
})

describe("Ripgrep concurrency", () => {
  const state = { active: 0, max: 0 }
  const tracking = mockedIt(() =>
    Effect.gen(function* () {
      state.active += 1
      state.max = Math.max(state.max, state.active)
      yield* Effect.sleep("30 millis")
      state.active -= 1
      return fakeHandle({ code: 1 })
    }),
  )

  tracking.live("bounds concurrent ripgrep subprocesses", () =>
    Effect.gen(function* () {
      state.active = 0
      state.max = 0
      const ripgrep = yield* Ripgrep.Service
      const results = yield* Effect.forEach(Array.from({ length: 12 }, (_, index) => index), () =>
        ripgrep.grep({ cwd: "/tmp", pattern: "needle", limit: 10 }),
      { concurrency: "unbounded" })
      expect(results).toHaveLength(12)
      expect(state.max).toBeLessThanOrEqual(Ripgrep.MAX_CONCURRENT_RIPGREP)
      expect(state.max).toBeGreaterThan(1)
    }),
  )
})
