import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, PlatformError, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectSchema } from "@opencode/core/project/schema"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Hash } from "@opencode/util/hash"
import { initGit } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node])))

describe("Project.list", () => {
  it.effect("returns complete projects ordered by recent activity", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* Project.Service
      yield* db
        .insert(ProjectTable)
        .values([
          {
            id: Project.ID.make("older"),
            worktree: abs("/older"),
            vcs: "git",
            name: "Older",
            icon_color: "#000000",
            commands: { start: "bun dev" },
            sandboxes: [abs("/older/sandbox")],
            time_created: 1,
            time_updated: 1,
            time_active: 4,
          },
          {
            id: Project.ID.make("newer"),
            worktree: abs("/newer"),
            sandboxes: [],
            time_created: 2,
            time_updated: 2,
            time_initialized: 3,
            time_active: 3,
          },
        ])
        .run()

      expect(yield* project.list()).toEqual([
        {
          id: Project.ID.make("older"),
          canonical: abs("/older"),
          vcs: "git",
          name: "Older",
          icon: { color: "#000000" },
          commands: { start: "bun dev" },
          time: { created: 1, updated: 1, active: 4 },
          sandboxes: [abs("/older/sandbox")],
        },
        {
          id: Project.ID.make("newer"),
          canonical: abs("/newer"),
          time: { created: 2, updated: 2, active: 3 },
          sandboxes: [],
        },
      ])
    }),
  )
})

describe("Project.update", () => {
  it.effect("updates and clears project metadata", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* Project.Service
      const id = Project.ID.make("update")
      yield* db
        .insert(ProjectTable)
        .values({
          id,
          worktree: abs("/update"),
          sandboxes: [],
          time_created: 1,
          time_updated: 1,
          time_active: 1,
        })
        .run()

      expect(
        yield* project.update({
          projectID: id,
          name: "Updated",
          icon: { color: "blue", override: "data:image/png;base64,test" },
          commands: { start: "bun install" },
        }),
      ).toMatchObject({
        id,
        name: "Updated",
        icon: { color: "blue", override: "data:image/png;base64,test" },
        commands: { start: "bun install" },
      })

      expect(
        yield* project.update({
          projectID: id,
          name: "",
          icon: { color: "", override: "" },
          commands: { start: "" },
        }),
      ).toMatchObject({ id })
      expect((yield* project.list())[0]).toEqual({
        id,
        canonical: abs("/update"),
        time: { created: 1, updated: expect.any(Number), active: 1 },
        sandboxes: [],
      })
    }),
  )
})

describe("Project.activate", () => {
  it.effect("records activity without editing metadata time and throttles repeats", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* Project.Service
      const id = Project.ID.make("activate")
      yield* db
        .insert(ProjectTable)
        .values({ id, worktree: abs("/activate"), sandboxes: [], time_created: 1, time_updated: 1, time_active: 1 })
        .run()

      yield* project.activate(id)
      const first = (yield* project.list())[0]
      expect(first?.time.updated).toBe(1)
      expect(first?.time.active).toBeGreaterThan(1)

      yield* db.update(ProjectTable).set({ time_active: 2, time_updated: 1 }).run()
      yield* project.activate(id)
      expect((yield* project.list())[0]?.time).toEqual({ created: 1, updated: 1, active: 2 })
    }),
  )
})

describe("Project archiving", () => {
  it.effect("lists archived projects only when requested", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* Project.Service
      yield* db
        .insert(ProjectTable)
        .values([
          { id: Project.ID.make("active"), worktree: abs("/active"), sandboxes: [], time_active: 2 },
          {
            id: Project.ID.make("archived"),
            worktree: abs("/archived"),
            sandboxes: [],
            time_active: 1,
            time_archived: 5,
          },
        ])
        .run()

      expect((yield* project.list()).map((item) => item.id)).toEqual([Project.ID.make("active")])
      const all = yield* project.list({ archived: true })
      expect(all.map((item) => item.id)).toEqual([Project.ID.make("active"), Project.ID.make("archived")])
      expect(all[1]?.time.archived).toBe(5)
    }),
  )

  it.live("archives projects whose directories are gone and unarchives them on resolve", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const kept = path.join(tmp.path, "kept")
      const removed = path.join(tmp.path, "removed")
      yield* Effect.promise(() => Promise.all([fs.mkdir(kept), fs.mkdir(removed)]))
      const project = yield* Project.Service
      const bus = yield* Bus.Service
      const keptProject = yield* project.resolve(abs(kept))
      const removedProject = yield* project.resolve(abs(removed))
      yield* project.update({ projectID: removedProject.id, name: "Removed" })
      yield* idle()
      const updated = (yield* project.list()).find((item) => item.id === removedProject.id)?.time.updated
      const updates: Project.Info[] = []
      yield* bus.subscribe(ProjectSchema.Event.Updated).pipe(
        Stream.runForEach((event) => Effect.sync(() => updates.push(event.data))),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Effect.promise(() => fs.rm(removed, { recursive: true }))
      yield* project.sweep()
      yield* project.sweep()
      yield* Effect.yieldNow

      expect((yield* project.list()).map((item) => item.id)).toEqual([keptProject.id])
      const archived = (yield* project.list({ archived: true })).find((item) => item.id === removedProject.id)
      expect(archived?.time.archived).toBeNumber()
      expect(archived?.time.updated).toBe(updated)
      expect(updates).toEqual([archived!])

      yield* Effect.promise(() => fs.mkdir(removed))
      yield* project.resolve(abs(removed))
      yield* project.resolve(abs(removed))
      yield* Effect.yieldNow

      const restored = (yield* project.list()).find((item) => item.id === removedProject.id)
      expect(restored).toMatchObject({ name: "Removed", time: { updated } })
      expect(restored?.time.archived).toBeUndefined()
      expect(updates).toEqual([archived!, restored!])
    }),
  )

  it.live("moves the canonical directory to a surviving clone instead of archiving", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const main = path.join(tmp.path, "repo")
      const clone = path.join(tmp.path, "clone")
      const linked = path.join(tmp.path, "linked")
      yield* Effect.promise(async () => {
        await fs.mkdir(main)
        await initRepo(main, { commit: true, remote: "git@github.com:owner/repo.git" })
        await $`git clone --no-hardlinks ${main} ${clone}`.quiet()
        await $`git remote set-url origin git@github.com:owner/repo.git`.cwd(clone).quiet()
        await $`git worktree add ${linked} -b linked`.cwd(main).quiet()
      })
      const project = yield* Project.Service
      const initial = yield* project.resolve(abs(main))
      yield* project.resolve(abs(linked))
      yield* project.resolve(abs(clone))
      yield* idle()

      yield* Effect.promise(() => fs.rm(main, { recursive: true }))
      yield* project.sweep()

      const info = (yield* project.list()).find((item) => item.id === initial.id)
      expect(info?.canonical).toBe(yield* real(clone))
      expect(info?.time.archived).toBeUndefined()
    }),
  )

  it.live("skips projects updated or active within the last sweep interval", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* Project.Service
      const old = Date.now() - 2 * 60 * 60 * 1000
      yield* db
        .insert(ProjectTable)
        .values([
          {
            id: Project.ID.make("updated"),
            worktree: abs("/opencode-missing-updated"),
            sandboxes: [],
            time_active: old,
          },
          {
            id: Project.ID.make("active"),
            worktree: abs("/opencode-missing-active"),
            sandboxes: [],
            time_updated: old,
          },
          {
            id: Project.ID.make("idle"),
            worktree: abs("/opencode-missing-idle"),
            sandboxes: [],
            time_updated: old,
            time_active: old,
          },
        ])
        .run()

      yield* project.sweep()

      expect((yield* project.list()).map((item) => item.id).toSorted()).toEqual([
        Project.ID.make("active"),
        Project.ID.make("updated"),
      ])
    }),
  )

  it.effect("never archives the global project", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* Project.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: Project.ID.global,
          worktree: abs("/opencode-missing-global"),
          sandboxes: [],
          time_updated: 1,
          time_active: 1,
        })
        .run()

      yield* project.sweep()

      expect((yield* project.list()).map((item) => item.id)).toEqual([Project.ID.global])
    }),
  )
})

// Backdates every Project past the sweep's recent-activity window.
const idle = Effect.fn(function* () {
  const db = (yield* Database.Service).db
  yield* db.update(ProjectTable).set({ time_updated: 1, time_active: 1 }).run()
})

function remoteID(remote: string) {
  return Project.ID.make(Hash.fast(`git-remote:${remote}`))
}

function abs(value: string) {
  return AbsolutePath.make(value)
}

function real(value: string) {
  return Effect.promise(() => fs.realpath(value)).pipe(Effect.map((value) => AbsolutePath.make(value)))
}

async function initRepo(dir: string, opts?: { commit?: boolean; remote?: string }) {
  await initGit(dir)
  if (opts?.commit) await $`git commit --allow-empty -m root`.cwd(dir).quiet()
  if (opts?.remote) await $`git remote add origin ${opts.remote}`.cwd(dir).quiet()
}

async function rootCommit(dir: string) {
  return (await $`git rev-list --max-parents=0 HEAD`.cwd(dir).text()).trim()
}

describe("Project.resolve", () => {
  it.live("creates distinct deterministic projects for exact markerless directories", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = yield* Project.Service
      const nested = path.join(tmp.path, "notes", "drafts")
      yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))

      const result = yield* project.resolve(abs(tmp.path))
      const repeated = yield* project.resolve(abs(`${tmp.path}${path.sep}.`))
      const child = yield* project.resolve(abs(nested))

      expect(result.id).not.toBe(Project.ID.global)
      expect(repeated.id).toBe(result.id)
      expect(child.id).not.toBe(result.id)
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(child.directory).toBe(yield* real(nested))
      expect(result.canonical).toBe(result.directory)
      expect(result.previous).toBeUndefined()
      expect(result.vcs).toBeUndefined()
    }),
  )

  it.live("repository markers override markerless directory projects", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const nested = path.join(tmp.path, "packages", "app")
      yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))
      const project = yield* Project.Service
      const root = yield* project.resolve(abs(tmp.path))
      const child = yield* project.resolve(abs(nested))

      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      const repository = yield* project.resolve(abs(nested))

      expect(root.id).not.toBe(child.id)
      expect(repository.id).not.toBe(root.id)
      expect(repository.id).not.toBe(child.id)
      expect(repository.directory).toBe(yield* real(tmp.path))
      expect(repository.vcs?.type).toBe("git")
    }),
  )

  it.live("does not publish project updates for first or repeated resolutions", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      const project = yield* Project.Service
      const bus = yield* Bus.Service
      const updates: Project.Info[] = []
      yield* bus.subscribe(ProjectSchema.Event.Updated).pipe(
        Stream.runForEach((event) => Effect.sync(() => updates.push(event.data))),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* project.resolve(abs(tmp.path))
      yield* project.resolve(abs(tmp.path))
      yield* Effect.yieldNow

      expect(updates).toEqual([])
    }),
  )

  it.live("publishes preserved project metadata when its canonical directory is renamed", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const before = path.join(tmp.path, "before")
      const after = path.join(tmp.path, "after")
      yield* Effect.promise(() => fs.mkdir(before))
      yield* Effect.promise(() => initRepo(before, { commit: true, remote: "git@github.com:owner/repo.git" }))
      const project = yield* Project.Service
      const bus = yield* Bus.Service
      const initial = yield* project.resolve(abs(before))
      yield* project.update({ projectID: initial.id, name: "Preserved name" })
      const updates: Project.Info[] = []
      yield* bus.subscribe(ProjectSchema.Event.Updated).pipe(
        Stream.runForEach((event) => Effect.sync(() => updates.push(event.data))),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Effect.promise(() => fs.rename(before, after))
      const renamed = yield* project.resolve(abs(after))
      yield* Effect.yieldNow

      expect(renamed.id).toBe(initial.id)
      expect(renamed.canonical).toBe(yield* real(after))
      expect(updates).toHaveLength(1)
      expect(updates).toEqual((yield* project.list()).filter((item) => item.id === initial.id))
      expect(updates[0]).toMatchObject({
        id: initial.id,
        canonical: yield* real(after),
        name: "Preserved name",
      })
    }),
  )

  it.live("keeps the canonical project directory when opening another clone", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const main = path.join(tmp.path, "repo")
      const clone = path.join(tmp.path, "other-clone")
      const linked = path.join(tmp.path, "linked")
      yield* Effect.promise(async () => {
        await fs.mkdir(main)
        await initRepo(main, { commit: true, remote: "git@github.com:owner/repo.git" })
        await $`git clone --no-hardlinks ${main} ${clone}`.quiet()
        await $`git remote set-url origin https://github.com/owner/repo.git`.cwd(clone).quiet()
        await $`git worktree add ${linked} -b linked`.cwd(main).quiet()
      })
      const project = yield* Project.Service
      const bus = yield* Bus.Service
      const initial = yield* project.resolve(abs(main))
      const updates: Project.Info[] = []
      yield* bus.subscribe(ProjectSchema.Event.Updated).pipe(
        Stream.runForEach((event) => Effect.sync(() => updates.push(event.data))),
        Effect.forkScoped({ startImmediately: true }),
      )

      for (const directory of [clone, linked, main, clone]) {
        const resolved = yield* project.resolve(abs(directory))
        expect(resolved.id).toBe(initial.id)
        expect(resolved.directory).toBe(abs(directory))
        expect(resolved.canonical).toBe(abs(directory === clone ? clone : main))
        expect((yield* project.list()).find((item) => item.id === initial.id)?.canonical).toBe(abs(main))
      }
      yield* Effect.yieldNow

      expect(updates).toEqual([])
    }),
  )

  it.live("returns git global for repo with no commits and no remote", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path))
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(Project.ID.make("global"))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.canonical).toBe(result.directory)
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
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(Project.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.canonical).toBe(result.directory)
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
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(remoteID("github.com/Acme/App"))
      expect(result.id).not.toBe(Project.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
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
      const project = yield* Project.Service

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
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(Project.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
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
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.previous).toBe(Project.ID.make("old-id"))
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
      const project = yield* Project.Service

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
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(path.join(tmp.path, "a", "b")))

      expect(result.directory).toBe(yield* real(tmp.path))
    }),
  )

  it.live("prefers git when both git and mercurial metadata exist", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".hg")))
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("prefers the nearest mercurial marker over an outer git repository", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const nested = path.join(tmp.path, "nested")
      yield* Effect.promise(async () => {
        await initRepo(tmp.path, { commit: true })
        await fs.mkdir(path.join(nested, ".hg"), { recursive: true })
        await fs.mkdir(path.join(nested, "app"))
      })
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(path.join(nested, "app")))

      expect(result.vcs?.type).toBe("hg")
      expect(result.directory).toBe(yield* real(nested))
    }),
  )

  it.live("prefers the nearest git marker over an outer mercurial repository", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const nested = path.join(tmp.path, "nested")
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(tmp.path, ".hg"))
        await fs.mkdir(path.join(nested, "app"), { recursive: true })
        await initRepo(nested, { commit: true })
      })
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(path.join(nested, "app")))

      expect(result.vcs?.type).toBe("git")
      expect(result.directory).toBe(yield* real(nested))
    }),
  )

  it.live("returns global id for unreadable mercurial metadata", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".hg")))
      const project = yield* Project.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.vcs?.type).toBe("hg")
      expect(result.id).toBe(Project.ID.make("global"))
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
      const project = yield* Project.Service
      const db = (yield* Database.Service).db
      const id = remoteID("github.com/owner/repo")
      yield* db
        .insert(ProjectTable)
        .values({
          id,
          worktree: abs("/stale-worktree"),
          vcs: "hg",
          name: "Preserved name",
          icon_color: "#123456",
          commands: { start: "bun dev" },
          sandboxes: [abs("/preserved-sandbox")],
          time_created: 1,
          time_updated: 1,
          time_initialized: 2,
        })
        .run()

      const result = yield* project.resolve(abs(worktree))

      expect(result.directory).toBe(yield* real(worktree))
      expect(result.canonical).toBe(yield* real(tmp.path))
      expect(result.previous).toBe(Project.ID.make("old-id"))
      expect(result.id).toBe(id)
      expect(result.vcs?.type).toBe("git")
      expect((yield* project.list()).find((item) => item.id === id)).toMatchObject({
        canonical: yield* real(tmp.path),
        vcs: "git",
        name: "Preserved name",
        icon: { color: "#123456" },
        commands: { start: "bun dev" },
        sandboxes: [abs("/preserved-sandbox")],
        time: { created: 1 },
      })
    }),
  )

  testEffect(Layer.empty).live(
    "caches git discovery across repeat, subdirectory, worktree, and concurrent resolves, and invalidates on external git changes",
    () =>
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const main = path.join(tmp.path, "repo")
        const nested = path.join(main, "packages", "app")
        const linked = path.join(tmp.path, "linked")
        const linkedNested = path.join(linked, "packages", "app")
        yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))
        let spawns = 0
        const layer = AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node]), [
          CrossSpawnSpawner.node.replace(
            CrossSpawnSpawner.node.mapLayer((base) =>
              Layer.effect(
                ChildProcessSpawner.ChildProcessSpawner,
                Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
                  ChildProcessSpawner.make((command) => {
                    spawns++
                    return spawner.spawn(command)
                  }),
                ),
              ).pipe(Layer.provide(base)),
            ),
          ),
        ])

        yield* Effect.gen(function* () {
          const project = yield* Project.Service
          const mainReal = yield* real(main)
          const nestedReal = yield* real(nested)

          const markerless = yield* project.resolve(abs(nested))
          expect(markerless.vcs).toBeUndefined()
          expect(markerless.directory).toBe(nestedReal)
          expect(spawns).toBe(0)

          yield* Effect.promise(() => initRepo(main))
          const unborn = yield* project.resolve(abs(nested))
          expect(unborn.id).toBe(Project.ID.global)
          expect(unborn.directory).toBe(mainReal)
          expect(unborn.vcs?.type).toBe("git")
          const afterInitSpawns = spawns
          expect(afterInitSpawns).toBeGreaterThan(0)

          // Repeat and concurrent resolves across root and subdirectory spawn no git processes.
          const [repeatRoot, repeatNested] = yield* Effect.all(
            [project.resolve(abs(main)), project.resolve(abs(nested))],
            { concurrency: "unbounded" },
          )
          expect(repeatRoot.id).toBe(Project.ID.global)
          expect(repeatNested.id).toBe(Project.ID.global)
          expect(spawns).toBe(afterInitSpawns)

          yield* Effect.promise(() => $`git commit --allow-empty -m root`.cwd(main).quiet())
          const rootSha = Project.ID.make(yield* Effect.promise(() => rootCommit(main)))
          const committed = yield* project.resolve(abs(nested))
          expect(committed.id).toBe(rootSha)
          const afterCommitSpawns = spawns
          expect(afterCommitSpawns).toBeGreaterThan(afterInitSpawns)

          expect((yield* project.resolve(abs(main))).id).toBe(rootSha)
          expect((yield* project.resolve(abs(nested))).id).toBe(rootSha)
          expect(spawns).toBe(afterCommitSpawns)

          yield* Effect.promise(() => $`git remote add origin git@github.com:owner/repo.git`.cwd(main).quiet())
          const originID = remoteID("github.com/owner/repo")
          const withRemote = yield* project.resolve(abs(nested))
          expect(withRemote.id).toBe(originID)
          const afterRemoteSpawns = spawns
          expect(afterRemoteSpawns).toBeGreaterThan(afterCommitSpawns)

          expect((yield* project.resolve(abs(main))).id).toBe(originID)
          expect((yield* project.resolve(abs(nested))).id).toBe(originID)
          expect(spawns).toBe(afterRemoteSpawns)

          yield* Effect.promise(async () => {
            await $`git worktree add ${linked} -b linked`.cwd(main).quiet()
            await fs.mkdir(linkedNested, { recursive: true })
          })
          const linkedReal = yield* real(linked)
          // Concurrent first resolves of the linked worktree share one git discovery computation.
          const [wtFirst, wtSecond] = yield* Effect.all(
            [project.resolve(abs(linked)), project.resolve(abs(linkedNested))],
            { concurrency: "unbounded" },
          )
          expect(wtFirst).toMatchObject({ id: originID, directory: linkedReal, canonical: mainReal })
          expect(wtSecond).toMatchObject({ id: originID, directory: linkedReal, canonical: mainReal })
          const afterWorktreeSpawns = spawns
          expect(afterWorktreeSpawns - afterRemoteSpawns).toBe(3)

          expect((yield* project.resolve(abs(linked))).id).toBe(originID)
          expect((yield* project.resolve(abs(linkedNested))).id).toBe(originID)
          expect(spawns).toBe(afterWorktreeSpawns)

          yield* Effect.promise(() =>
            $`git remote set-url origin https://github.com/owner/renamed.git`.cwd(main).quiet(),
          )
          const renamedID = remoteID("github.com/owner/renamed")
          expect((yield* project.resolve(abs(linkedNested))).id).toBe(renamedID)
          expect((yield* project.resolve(abs(nested))).id).toBe(renamedID)

          yield* Effect.promise(() => $`git remote remove origin`.cwd(main).quiet())
          expect((yield* project.resolve(abs(linkedNested))).id).toBe(rootSha)
          expect((yield* project.resolve(abs(nested))).id).toBe(rootSha)
        }).pipe(Effect.provide(layer))
      }),
  )

  testEffect(Layer.empty).live("does not cache transient git spawn failures during discovery", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      const rootSha = Project.ID.make(yield* Effect.promise(() => rootCommit(tmp.path)))
      const originID = remoteID("github.com/owner/repo")
      let failRemote = true
      let spawns = 0
      const layer = AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node]), [
        CrossSpawnSpawner.node.replace(
          CrossSpawnSpawner.node.mapLayer((base) =>
            Layer.effect(
              ChildProcessSpawner.ChildProcessSpawner,
              Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
                ChildProcessSpawner.make((command) => {
                  spawns++
                  if (failRemote && command._tag === "StandardCommand" && command.args.includes("remote")) {
                    failRemote = false
                    return Effect.fail(
                      PlatformError.systemError({ _tag: "Busy", module: "ChildProcess", method: "spawn" }),
                    )
                  }
                  return spawner.spawn(command)
                }),
              ),
            ).pipe(Layer.provide(base)),
          ),
        ),
      ])

      yield* Effect.gen(function* () {
        const project = yield* Project.Service
        // First resolve hits a transient `git remote` spawn failure and falls back to root commit uncached.
        const degraded = yield* project.resolve(abs(tmp.path))
        expect(degraded.id).toBe(rootSha)

        // Next resolve retries git discovery without any .git file change and caches the recovered remote ID.
        const recovered = yield* project.resolve(abs(tmp.path))
        expect(recovered.id).toBe(originID)
        const afterRecoverSpawns = spawns

        const cached = yield* project.resolve(abs(tmp.path))
        expect(cached.id).toBe(originID)
        expect(spawns).toBe(afterRecoverSpawns)
      }).pipe(Effect.provide(layer))
    }),
  )

  testEffect(Layer.empty).live("invalidates cached discovery on first commit and root rewrite in a reftable repo", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const repo = path.join(tmp.path, "reftable")
      const supported = yield* Effect.promise(async () => {
        const res = await $`git init -q --ref-format=reftable ${repo}`.nothrow().quiet()
        if (res.exitCode !== 0) return false
        await $`git config user.email test@opencode.test`.cwd(repo).quiet()
        await $`git config user.name Test`.cwd(repo).quiet()
        await $`git config commit.gpgsign false`.cwd(repo).quiet()
        return true
      })
      if (!supported) return

      let spawns = 0
      const layer = AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node]), [
        CrossSpawnSpawner.node.replace(
          CrossSpawnSpawner.node.mapLayer((base) =>
            Layer.effect(
              ChildProcessSpawner.ChildProcessSpawner,
              Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
                ChildProcessSpawner.make((command) => {
                  spawns++
                  return spawner.spawn(command)
                }),
              ),
            ).pipe(Layer.provide(base)),
          ),
        ),
      ])

      yield* Effect.gen(function* () {
        const project = yield* Project.Service
        const unborn = yield* project.resolve(abs(repo))
        expect(unborn.id).toBe(Project.ID.global)
        const afterUnbornSpawns = spawns
        expect((yield* project.resolve(abs(repo))).id).toBe(Project.ID.global)
        expect(spawns).toBe(afterUnbornSpawns)

        yield* Effect.promise(() => $`git commit --allow-empty -m first`.cwd(repo).quiet())
        const firstRoot = Project.ID.make(yield* Effect.promise(() => rootCommit(repo)))
        expect((yield* project.resolve(abs(repo))).id).toBe(firstRoot)
        const afterFirstSpawns = spawns
        expect((yield* project.resolve(abs(repo))).id).toBe(firstRoot)
        expect(spawns).toBe(afterFirstSpawns)

        yield* Effect.promise(() => $`git commit --amend --allow-empty -m rewritten`.cwd(repo).quiet())
        const rewrittenRoot = Project.ID.make(yield* Effect.promise(() => rootCommit(repo)))
        expect(rewrittenRoot).not.toBe(firstRoot)
        expect((yield* project.resolve(abs(repo))).id).toBe(rewrittenRoot)
      }).pipe(Effect.provide(layer))
    }),
  )
})
