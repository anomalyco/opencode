import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { Project } from "@opencode-ai/core/project"
import { ProjectSchema } from "@opencode-ai/core/project/schema"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Hash } from "@opencode-ai/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node])))

describe("Project.list", () => {
  it.effect("returns complete projects ordered by recent update", () =>
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
          },
          {
            id: Project.ID.make("newer"),
            worktree: abs("/newer"),
            sandboxes: [],
            time_created: 2,
            time_updated: 2,
            time_initialized: 3,
          },
        ])
        .run()

      expect(yield* project.list()).toEqual([
        {
          id: Project.ID.make("newer"),
          canonical: abs("/newer"),
          time: { created: 2, updated: 2, initialized: 3 },
          sandboxes: [],
        },
        {
          id: Project.ID.make("older"),
          canonical: abs("/older"),
          vcs: "git",
          name: "Older",
          icon: { color: "#000000" },
          commands: { start: "bun dev" },
          time: { created: 1, updated: 1 },
          sandboxes: [abs("/older/sandbox")],
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
        time: { created: 1, updated: expect.any(Number) },
        sandboxes: [],
      })
    }),
  )
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
        time: { created: 1, initialized: 2 },
      })
    }),
  )
})
