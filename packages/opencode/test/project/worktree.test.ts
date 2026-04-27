import { $ } from "bun"
import { afterEach, describe, expect } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { provideInstance, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Worktree.defaultLayer, CrossSpawnSpawner.defaultLayer))
const wintest = process.platform !== "win32" ? it.live : it.live.skip

function normalize(input: string) {
  return input.replace(/\\/g, "/").toLowerCase()
}

async function waitReady() {
  const { GlobalBus } = await import("../../src/bus/global")

  return await new Promise<{ name: string; branch: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", on)
      reject(new Error("timed out waiting for worktree.ready"))
    }, 10_000)

    function on(evt: { directory?: string; payload: { type: string; properties: { name: string; branch: string } } }) {
      if (evt.payload.type !== Worktree.Event.Ready.type) return
      clearTimeout(timer)
      GlobalBus.off("event", on)
      resolve(evt.payload.properties)
    }

    GlobalBus.on("event", on)
  })
}

describe("Worktree", () => {
  afterEach(() => Instance.disposeAll())

  describe("makeWorktreeInfo", () => {
    it.live("returns info with name, branch, and directory", () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const info = yield* svc.makeWorktreeInfo()

            expect(info.name).toBeDefined()
            expect(typeof info.name).toBe("string")
            expect(info.branch).toBe(`opencode/${info.name}`)
            expect(info.directory).toContain(info.name)
          }),
        { git: true },
      ),
    )

    it.live("uses provided name as base", () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const info = yield* svc.makeWorktreeInfo("my-feature")

            expect(info.name).toBe("my-feature")
            expect(info.branch).toBe("opencode/my-feature")
          }),
        { git: true },
      ),
    )

    it.live("slugifies the provided name", () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const info = yield* svc.makeWorktreeInfo("My Feature Branch!")

            expect(info.name).toBe("my-feature-branch")
          }),
        { git: true },
      ),
    )

    it.live("throws NotGitError for non-git directories", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const exit = yield* Effect.exit(svc.makeWorktreeInfo())

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Worktree.NotGitError)
        }),
      ),
    )
  })

  describe("create + remove lifecycle", () => {
    it.live("create returns worktree info and remove cleans up", () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const info = yield* svc.create()

            expect(info.name).toBeDefined()
            expect(info.branch).toStartWith("opencode/")
            expect(info.directory).toBeDefined()

            yield* Effect.promise(() => Bun.sleep(1000))

            const ok = yield* svc.remove({ directory: info.directory })
            expect(ok).toBe(true)
          }),
        { git: true },
      ),
    )

    it.live("create returns after setup and fires Event.Ready after bootstrap", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const ready = waitReady()
            const info = yield* svc.create()

            expect(info.name).toBeDefined()
            expect(info.branch).toStartWith("opencode/")

            const text = yield* Effect.promise(() => $`git worktree list --porcelain`.cwd(dir).quiet().text())
            const next = yield* Effect.promise(() => fs.realpath(info.directory).catch(() => info.directory))
            expect(normalize(text)).toContain(normalize(next))

            const props = yield* Effect.promise(() => ready)
            expect(props.name).toBe(info.name)
            expect(props.branch).toBe(info.branch)

            yield* Effect.promise(() => Instance.dispose()).pipe(provideInstance(info.directory))
            yield* Effect.promise(() => Bun.sleep(100))
            yield* svc.remove({ directory: info.directory })
          }),
        { git: true },
      ),
    )

    it.live("create with custom name", () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const ready = waitReady()
            const info = yield* svc.create({ name: "test-workspace" })

            expect(info.name).toBe("test-workspace")
            expect(info.branch).toBe("opencode/test-workspace")

            yield* Effect.promise(() => ready)
            yield* Effect.promise(() => Instance.dispose()).pipe(provideInstance(info.directory))
            yield* Effect.promise(() => Bun.sleep(100))
            yield* svc.remove({ directory: info.directory })
          }),
        { git: true },
      ),
    )
  })

  describe("createFromInfo", () => {
    wintest("creates and bootstraps git worktree", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const info = yield* svc.makeWorktreeInfo("from-info-test")
            yield* svc.createFromInfo(info)

            const list = yield* Effect.promise(() => $`git worktree list --porcelain`.cwd(dir).quiet().text())
            const normalizedList = list.replace(/\\/g, "/")
            const normalizedDir = info.directory.replace(/\\/g, "/")
            expect(normalizedList).toContain(normalizedDir)

            yield* svc.remove({ directory: info.directory })
          }),
        { git: true },
      ),
    )
  })

  describe("remove edge cases", () => {
    it.live("remove non-existent directory succeeds silently", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const svc = yield* Worktree.Service
            const ok = yield* svc.remove({ directory: path.join(dir, "does-not-exist") })
            expect(ok).toBe(true)
          }),
        { git: true },
      ),
    )

    it.live("throws NotGitError for non-git directories", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const exit = yield* Effect.exit(svc.remove({ directory: "/tmp/fake" }))

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Worktree.NotGitError)
        }),
      ),
    )
  })
})
