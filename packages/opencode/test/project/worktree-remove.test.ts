import { $ } from "bun"
import { describe, expect } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Worktree } from "../../src/worktree"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Worktree.defaultLayer, CrossSpawnSpawner.defaultLayer))
const wintest = process.platform === "win32" ? it.live : it.live.skip
const nonWindowsTest = process.platform === "win32" ? it.live.skip : it.live
const gitShimName = process.platform === "win32" ? "git.cmd" : "git"

function gitShim(real: string, mode: "remove-detaches" | "remove-stays") {
  if (process.platform === "win32") {
    const runReal = mode === "remove-detaches" ? `"${real}" %* >nul 2>nul` : ""
    return [
      "@echo off",
      'if "%1"=="worktree" if "%2"=="remove" (',
      ...(runReal ? [`  ${runReal}`] : []),
      mode === "remove-detaches"
        ? '  echo fatal: failed to remove worktree: Directory not empty 1>&2'
        : '  echo fatal: simulated worktree remove failure 1>&2',
      "  exit /b 1",
      ")",
      `"${real}" %*`,
      "exit /b %ERRORLEVEL%",
    ].join("\r\n")
  }
  return [
    "#!/bin/bash",
    `REAL_GIT=${JSON.stringify(real)}`,
    'if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then',
    ...(mode === "remove-detaches" ? ['  "$REAL_GIT" "$@" >/dev/null 2>&1'] : []),
    mode === "remove-detaches"
      ? '  echo "fatal: failed to remove worktree: Directory not empty" >&2'
      : '  echo "fatal: simulated worktree remove failure" >&2',
    "  exit 1",
    "fi",
    'exec "$REAL_GIT" "$@"',
  ].join("\n")
}

describe("Worktree.remove", () => {
  it.effect("classifies Windows EBUSY cleanup as deferred success", () =>
    Effect.gen(function* () {
      const result = yield* Worktree.removePhysicalDirectory("locked", () =>
        Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })),
      )

      expect(result.cleanupDeferred).toBe(process.platform === "win32")
    }),
  )

  it.effect("treats unknown cleanup errors as hard remove failures", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Worktree.removePhysicalDirectory("unknown", () =>
          Promise.reject(Object.assign(new Error("surprise"), { code: "ENOUGH" })),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Worktree.RemoveFailedError)
    }),
  )

  it.live("continues when git remove exits non-zero after detaching", () =>
    provideTmpdirInstance(
      (root) =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const name = `remove-regression-${Date.now().toString(36)}`
          const info = yield* svc.makeWorktreeInfo({ name })
          const branch = info.branch!
          const dir = info.directory

          yield* Effect.promise(() => $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet())
          yield* Effect.promise(() => $`git reset --hard`.cwd(dir).quiet())

          const real = (yield* Effect.promise(() => $`which git`.quiet().text())).trim()
          expect(real).toBeTruthy()

          const bin = path.join(root, "bin")
          const shim = path.join(bin, gitShimName)
          yield* Effect.promise(() => fs.mkdir(bin, { recursive: true }))
          yield* Effect.promise(() => Bun.write(shim, gitShim(real, "remove-detaches")))
          yield* Effect.promise(() => fs.chmod(shim, 0o755))

          const prev = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const prev = process.env.PATH ?? ""
              process.env.PATH = `${bin}${path.delimiter}${prev}`
              return prev
            }),
            (prev) =>
              Effect.sync(() => {
                process.env.PATH = prev
              }),
          )
          void prev

          const ok = yield* svc.remove({ directory: dir })

          expect(ok).toEqual({ removed: true, cleanupDeferred: false })
          expect(
            yield* Effect.promise(() =>
              fs
                .stat(dir)
                .then(() => true)
                .catch(() => false),
            ),
          ).toBe(false)

          const list = yield* Effect.promise(() => $`git worktree list --porcelain`.cwd(root).quiet().text())
          expect(list).not.toContain(`worktree ${dir}`)

          const ref = yield* Effect.promise(() =>
            $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(root).quiet().nothrow(),
          )
          expect(ref.exitCode).not.toBe(0)
        }),
      { git: true },
    ),
  )

  it.live("does not let async bootstrap recreate a removed worktree directory", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const info = yield* svc.create({ name: `remove-boot-race-${Date.now().toString(36)}` })

          const removed = yield* svc.remove({ directory: info.directory })
          expect(removed).toEqual({ removed: true, cleanupDeferred: false })

          yield* Effect.sleep("2 seconds")
          expect(
            yield* Effect.promise(() =>
              fs
                .stat(info.directory)
                .then(() => true)
                .catch(() => false),
            ),
          ).toBe(false)
        }),
      { git: true },
    ),
  )

  nonWindowsTest("fails when git remove exits non-zero and worktree remains registered", () =>
    provideTmpdirInstance(
      (root) =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const name = `remove-hard-${Date.now().toString(36)}`
          const info = yield* svc.makeWorktreeInfo({ name })
          const branch = info.branch!
          const dir = info.directory

          yield* Effect.promise(() => $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet())
          yield* Effect.promise(() => $`git reset --hard`.cwd(dir).quiet())

          const real = (yield* Effect.promise(() => $`which git`.quiet().text())).trim()
          const bin = path.join(root, "bin-hard")
          const shim = path.join(bin, gitShimName)
          yield* Effect.promise(() => fs.mkdir(bin, { recursive: true }))
          yield* Effect.promise(() => Bun.write(shim, gitShim(real, "remove-stays")))
          yield* Effect.promise(() => fs.chmod(shim, 0o755))

          const prev = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const prev = process.env.PATH ?? ""
              process.env.PATH = `${bin}${path.delimiter}${prev}`
              return prev
            }),
            (prev) =>
              Effect.sync(() => {
                process.env.PATH = prev
              }),
          )
          void prev

          const exit = yield* Effect.exit(svc.remove({ directory: dir }))

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Worktree.RemoveFailedError)

          const list = yield* Effect.promise(() => $`git worktree list --porcelain`.cwd(root).quiet().text())
          expect(list).toContain(`worktree ${dir}`)

          yield* Effect.promise(() => $`git worktree remove --force ${dir}`.cwd(root).quiet())
          yield* Effect.promise(() => $`git branch -D ${branch}`.cwd(root).quiet())
        }),
      { git: true },
    ),
  )

  it.live("refuses to remove a worktree on a non-opencode branch", () =>
    provideTmpdirInstance(
      (root) =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const name = `remove-branch-safety-${Date.now().toString(36)}`
          const info = yield* svc.makeWorktreeInfo({ name, detached: true })
          const branch = `danger/${info.name}`

          yield* Effect.promise(() => $`git worktree add --no-checkout -b ${branch} ${info.directory}`.cwd(root).quiet())
          yield* Effect.promise(() => $`git reset --hard`.cwd(info.directory).quiet())
          expect(yield* svc.list()).toContainEqual(expect.objectContaining({ branch }))

          const exit = yield* Effect.exit(svc.remove({ directory: info.directory }))

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Worktree.RemoveFailedError)

          yield* Effect.promise(() => $`git worktree remove --force ${info.directory}`.cwd(root).quiet())
          yield* Effect.promise(() => $`git branch -D ${branch}`.cwd(root).quiet())
        }),
      { git: true },
    ),
  )

  wintest("stops fsmonitor before removing a worktree", () =>
    provideTmpdirInstance(
      (root) =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const name = `remove-fsmonitor-${Date.now().toString(36)}`
          const info = yield* svc.makeWorktreeInfo({ name })
          const branch = info.branch!
          const dir = info.directory

          yield* Effect.promise(() => $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet())
          yield* Effect.promise(() => $`git reset --hard`.cwd(dir).quiet())
          yield* Effect.promise(() => $`git config core.fsmonitor true`.cwd(dir).quiet())
          yield* Effect.promise(() => $`git fsmonitor--daemon stop`.cwd(dir).quiet().nothrow())
          yield* Effect.promise(() => Bun.write(path.join(dir, "tracked.txt"), "next\n"))
          yield* Effect.promise(() => $`git diff`.cwd(dir).quiet())

          const before = yield* Effect.promise(() => $`git fsmonitor--daemon status`.cwd(dir).quiet().nothrow())
          expect(before.exitCode).toBe(0)

          const ok = yield* svc.remove({ directory: dir })

          expect(ok).toEqual({ removed: true, cleanupDeferred: false })
          expect(
            yield* Effect.promise(() =>
              fs
                .stat(dir)
                .then(() => true)
                .catch(() => false),
            ),
          ).toBe(false)

          const ref = yield* Effect.promise(() =>
            $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(root).quiet().nothrow(),
          )
          expect(ref.exitCode).not.toBe(0)
        }),
      { git: true },
    ),
  )
})
