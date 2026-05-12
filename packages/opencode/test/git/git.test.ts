import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Git } from "../../src/git"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const weird = process.platform === "win32" ? "space file.txt" : "tab\tfile.txt"
const it = testEffect(Git.defaultLayer)

const scopedTmpdir = (options?: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

describe("Git", () => {
  it.live("branch() returns current branch name", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      const branch = yield* git.branch(tmp.path)
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    }),
  )

  it.live("branch() returns undefined for non-git directories", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir()
      const git = yield* Git.Service
      const branch = yield* git.branch(tmp.path)
      expect(branch).toBeUndefined()
    }),
  )

  it.live("branch() returns undefined for detached HEAD", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const hash = (yield* Effect.promise(() => $`git rev-parse HEAD`.cwd(tmp.path).quiet().text())).trim()
      yield* Effect.promise(() => $`git checkout --detach ${hash}`.cwd(tmp.path).quiet())
      const git = yield* Git.Service
      const branch = yield* git.branch(tmp.path)
      expect(branch).toBeUndefined()
    }),
  )

  it.live("defaultBranch() uses init.defaultBranch when available", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      yield* Effect.promise(() => $`git branch -M trunk`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git config init.defaultBranch trunk`.cwd(tmp.path).quiet())
      const git = yield* Git.Service
      const branch = yield* git.defaultBranch(tmp.path)
      expect(branch?.name).toBe("trunk")
      expect(branch?.ref).toBe("trunk")
    }),
  )

  it.live("status() handles special filenames", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weird), "hello\n", "utf-8"))
      const git = yield* Git.Service
      const status = yield* git.status(tmp.path)
      expect(status).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: weird,
            status: "added",
          }),
        ]),
      )
    }),
  )

  it.live("diff(), stats(), and mergeBase() parse tracked changes", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      yield* Effect.promise(() => $`git branch -M main`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weird), "before\n", "utf-8"))
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m "add file"`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git checkout -b feature/test`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weird), "after\n", "utf-8"))

      const git = yield* Git.Service
      const [base, diff, stats] = yield* Effect.all([
        git.mergeBase(tmp.path, "main"),
        git.diff(tmp.path, "HEAD"),
        git.stats(tmp.path, "HEAD"),
      ])

      expect(base).toBeTruthy()
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: weird,
            status: "modified",
          }),
        ]),
      )
      expect(stats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: weird,
            additions: 1,
            deletions: 1,
          }),
        ]),
      )
    }),
  )

  it.live("patch() returns capped native patch output", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weird), "before\n", "utf-8"))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "other.txt"), "old\n", "utf-8"))
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m "add file"`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weird), "after\n", "utf-8"))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "other.txt"), "new\n", "utf-8"))

      const git = yield* Git.Service
      const [patch, all, capped] = yield* Effect.all([
        git.patch(tmp.path, "HEAD", weird, { context: 2_147_483_647 }),
        git.patchAll(tmp.path, "HEAD", { context: 2_147_483_647 }),
        git.patch(tmp.path, "HEAD", weird, { maxOutputBytes: 1 }),
      ])

      expect(patch.truncated).toBe(false)
      expect(patch.text).toContain("diff --git")
      expect(patch.text).toContain("-before")
      expect(patch.text).toContain("+after")
      expect(all.truncated).toBe(false)
      expect(all.text).toContain("diff --git")
      expect(all.text).toContain("other.txt")
      expect(all.text).toContain("+new")
      expect(capped.truncated).toBe(true)
      expect(capped.text).toBe("")
    }),
  )

  it.live("patchUntracked() and statUntracked() handle added files", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weird), "one\ntwo\n", "utf-8"))

      const git = yield* Git.Service
      const [patch, stat] = yield* Effect.all([
        git.patchUntracked(tmp.path, weird, { context: 2_147_483_647 }),
        git.statUntracked(tmp.path, weird),
      ])

      expect(patch.truncated).toBe(false)
      expect(patch.text).toContain("diff --git")
      expect(patch.text).toContain("+one")
      expect(patch.text).toContain("+two")
      expect(stat).toEqual(expect.objectContaining({ file: weird, additions: 2, deletions: 0 }))
    }),
  )

  it.live("show() returns empty text for binary blobs", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "bin.dat"), new Uint8Array([0, 1, 2, 3])))
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m "add binary"`.cwd(tmp.path).quiet())

      const git = yield* Git.Service
      const text = yield* git.show(tmp.path, "HEAD", "bin.dat")
      expect(text).toBe("")
    }),
  )
})
