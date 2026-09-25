import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Hash } from "@opencode-ai/core/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(ProjectV2.node))
const itDb = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, ProjectV2.node])))

const associatedID = ProjectV2.ID.make("project-associated-directory")

function seedProject(id: ProjectV2.ID, worktree: AbsolutePath) {
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({ id, worktree, sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie),
  )
}

function tmp() {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
  )
}

function remoteID(remote: string) {
  return ProjectV2.ID.make(Hash.fast(`git-remote:${remote}`))
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

      expect(result.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
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

      expect(result.id).toBe(remoteID("github.com/Acme/App"))
      expect(result.id).not.toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.directory).toBe(yield* real(tmp.path))
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

      expect(a.id).toBe(remoteID("github.com/owner/repo"))
      expect(b.id).toBe(a.id)
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

      expect(result.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
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

      expect(result.previous).toBe(ProjectV2.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo"))
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

      expect(result.directory).toBe(yield* real(worktree))
      expect(result.previous).toBe(ProjectV2.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo"))
      expect(result.vcs?.type).toBe("git")
    }),
  )
})

describe("ProjectV2.resolve with an associated directory", () => {
  itDb.live("resolves a non-git directory to the project it is associated with", () =>
    Effect.gen(function* () {
      const dir = yield* tmp()
      const project = yield* ProjectV2.Service
      const directory = yield* real(dir.path)

      // Without the association the directory is unattributable.
      expect((yield* project.resolve(directory)).id).toBe(ProjectV2.ID.make("global"))

      yield* seedProject(associatedID, directory)
      yield* project.associate({ projectID: associatedID, directory })

      const result = yield* project.resolve(directory)

      expect(result.id).toBe(associatedID)
      expect(result.directory).toBe(directory)
      expect(result.vcs).toBeUndefined()
      expect(result.associated).toBe(true)
    }),
  )

  itDb.live("git discovery still wins over an association", () =>
    Effect.gen(function* () {
      const dir = yield* tmp()
      yield* Effect.promise(() => initRepo(dir.path, { remote: "https://github.com/owner/repo.git" }))
      const project = yield* ProjectV2.Service
      const directory = yield* real(dir.path)

      yield* seedProject(associatedID, directory)
      yield* project.associate({ projectID: associatedID, directory })

      const result = yield* project.resolve(directory)

      // The association is a fallback, never an override: a directory that is a git
      // worktree keeps the identity git gives it.
      expect(result.id).toBe(remoteID("github.com/owner/repo"))
      expect(result.id).not.toBe(associatedID)
      expect(result.vcs?.type).toBe("git")
    }),
  )

  itDb.live("dissociating restores the global result", () =>
    Effect.gen(function* () {
      const dir = yield* tmp()
      const project = yield* ProjectV2.Service
      const directory = yield* real(dir.path)

      yield* seedProject(associatedID, directory)
      yield* project.associate({ projectID: associatedID, directory })
      expect((yield* project.resolve(directory)).id).toBe(associatedID)

      expect(yield* project.dissociate({ projectID: associatedID, directory })).toEqual([])
      expect((yield* project.resolve(directory)).id).toBe(ProjectV2.ID.make("global"))
    }),
  )

  itDb.live("ignores an implicit directory record and transfers an explicit association", () =>
    Effect.gen(function* () {
      const dir = yield* tmp()
      const directory = yield* real(dir.path)
      const project = yield* ProjectV2.Service
      const oldID = ProjectV2.ID.make("old-project")
      yield* seedProject(oldID, directory)
      yield* seedProject(associatedID, directory)

      yield* Database.Service.use(({ db }) =>
        db
          .insert(ProjectDirectoryTable)
          .values({ project_id: oldID, directory })
          .run()
          .pipe(Effect.orDie),
      )
      expect((yield* project.resolve(directory)).id).toBe(ProjectV2.ID.global)

      yield* project.associate({ projectID: oldID, directory })
      expect((yield* project.resolve(directory)).id).toBe(oldID)

      yield* project.associate({ projectID: associatedID, directory })
      expect((yield* project.resolve(directory)).id).toBe(associatedID)
      expect(yield* project.directories({ projectID: oldID })).toEqual([])

      yield* project.dissociate({ projectID: associatedID, directory })
      expect((yield* project.resolve(directory)).id).toBe(ProjectV2.ID.global)
    }),
  )

  itDb.live("matches only the associated directory, not its descendants", () =>
    Effect.gen(function* () {
      const dir = yield* tmp()
      const directory = yield* real(dir.path)
      const nested = AbsolutePath.make(path.join(directory, "inputs"))
      yield* Effect.promise(() => fs.mkdir(nested))
      const project = yield* ProjectV2.Service
      yield* seedProject(associatedID, directory)
      yield* project.associate({ projectID: associatedID, directory })

      expect((yield* project.resolve(directory)).id).toBe(associatedID)
      expect((yield* project.resolve(nested)).id).toBe(ProjectV2.ID.global)
    }),
  )
})
