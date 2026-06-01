import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Hash } from "@opencode-ai/core/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(ProjectV2.defaultLayer)

function remoteID(remote: string, store: string) {
  const storeHash = Hash.short(store)
  return Project.ID.make(Hash.fast(`git-remote:${remote}|${storeHash}`))
}

function rootID(root: string, store: string) {
  const storeHash = Hash.short(store)
  return Project.ID.make(Hash.fast(`git-root:${root}|${storeHash}`))
}

function abs(value: string) {
  return AbsolutePath.make(value)
}

function real(value: string) {
  return Effect.promise(() => fs.realpath(value)).pipe(Effect.map((value) => AbsolutePath.make(value)))
}

async function initRepo(dir: string, opts?: { commit?: boolean; remote?: string }) {
  await $`git init`.cwd(dir).quiet()
  await $`git config core.fsmonitor false`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  await $`git config user.email test@opencode.test`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  if (opts?.commit) await $`git commit --allow-empty -m root`.cwd(dir).quiet()
  if (opts?.remote) await $`git remote add origin ${opts.remote}`.cwd(dir).quiet()
}

async function rootCommit(dir: string) {
  return (await $`git rev-list --max-parents=0 HEAD`.cwd(dir).text()).trim()
}

describe("ProjectV2.resolve", () => {
  it.live("returns global for non-git directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("global"))
      expect(path.resolve(result.directory)).toBe(path.parse(tmp.path).root)
      expect(result.previous).toBeUndefined()
      expect(result.vcs).toBeUndefined()
    }),
  )

  it.live("returns git global for repo with no commits and no remote", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("global"))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.previous).toBeUndefined()
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("falls back to root commit when origin is missing", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      const store = path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), ".git")
      expect(result.id).toBe(rootID(yield* Effect.promise(() => rootCommit(tmp.path)), store))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.previous).toBeUndefined()
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("prefers normalized origin over root commit", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:Acme/App.git" }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      const store = path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), ".git")
      expect(result.id).toBe(remoteID("github.com/Acme/App", store))
      expect(result.id).not.toBe(Project.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.previous).toBeUndefined()
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("normalizes ssh and https remotes to the same id", () =>
    Effect.gen(function* () {
      const ssh = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const https = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(ssh.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => initRepo(https.path, { commit: true, remote: "https://github.com/owner/repo.git" }))
      const project = yield* ProjectV2.Service

      const a = yield* project.resolve(abs(ssh.path))
      const b = yield* project.resolve(abs(https.path))

      // 两个独立 clone 的 store 不同，所以 ID 不同
      const storeSsh = path.join(yield* Effect.promise(() => fs.realpath(ssh.path)), ".git")
      const storeHttps = path.join(yield* Effect.promise(() => fs.realpath(https.path)), ".git")
      expect(a.id).not.toBe(Project.ID.global)
      expect(b.id).not.toBe(Project.ID.global)
      expect(a.id).toBe(remoteID("github.com/owner/repo", storeSsh))
      expect(b.id).toBe(remoteID("github.com/owner/repo", storeHttps))
      expect(a.id).not.toBe(b.id)
    }),
  )

  it.live("ignores file remotes and falls back to root commit", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: `file://${tmp.path}` }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      const store = path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), ".git")
      expect(result.id).toBe(rootID(yield* Effect.promise(() => rootCommit(tmp.path)), store))
    }),
  )

  it.live("returns previous cached id from common dir", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".git", "opencode"), "old-id"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      const store = path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), ".git")
      expect(result.previous).toBe(Project.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo", store))
    }),
  )

  it.live("does not write the cache while resolving", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      const project = yield* ProjectV2.Service

      yield* project.resolve(abs(tmp.path))

      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, ".git", "opencode")).exists())).toBe(false)
    }),
  )

  it.live("resolves from nested directories to repo root", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "a", "b"), { recursive: true }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(path.join(tmp.path, "a", "b")))

      expect(result.directory).toBe(yield* real(tmp.path))
    }),
  )

  it.live("linked worktree returns opened worktree directory and previous from common dir", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const worktree = `${tmp.path}-worktree`
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".git", "opencode"), "old-id"))
      yield* Effect.promise(() => $`git worktree add ${worktree} -b test-${Date.now()}`.cwd(tmp.path).quiet())
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(worktree))

      const store = path.join(yield* Effect.promise(() => fs.realpath(tmp.path)), ".git")
      expect(result.directory).toBe(yield* real(worktree))
      expect(result.previous).toBe(Project.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo", store))
      expect(result.vcs?.type).toBe("git")
    }),
  )
})
