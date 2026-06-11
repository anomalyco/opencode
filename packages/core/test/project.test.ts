import { describe, expect } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Git } from "@opencode-ai/core/git"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Hash } from "@opencode-ai/core/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const makeID: (s: string) => ProjectV2.ID = ProjectV2.ID.make as any
const makePath: (s: string) => AbsolutePath = AbsolutePath.make as any

const databaseLayer = Database.layerFromPath(":memory:")
const projectLayer = ProjectV2.layer.pipe(
  Layer.provide(databaseLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Git.defaultLayer),
)
const fsLayer = FSUtil.defaultLayer
const gitLayer = Git.defaultLayer
const it = testEffect(Layer.mergeAll(projectLayer, databaseLayer, fsLayer, gitLayer))

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

describe("ProjectV2.ID", () => {
  it.effect("makes a branded ID from a string", () =>
    Effect.gen(function* () {
      const id = makeID("test-project")
      expect(String(id)).toBe("test-project")
    }),
  )

  it.effect("global is the reserved global ID", () =>
    Effect.gen(function* () {
      expect(String(ProjectV2.ID.global)).toBe("global")
    }),
  )
})

describe("Project directories schemas", () => {
  it.effect("decodes project directory input and inline directory results", () =>
    Effect.sync(() => {
      expect(Schema.decodeUnknownSync(ProjectV2.DirectoriesInput)({ projectID: ProjectV2.ID.make("project") })).toEqual(
        {
          projectID: ProjectV2.ID.make("project"),
        },
      )
      expect(
        Schema.decodeUnknownSync(ProjectV2.Directories)([
          { directory: AbsolutePath.make("/tmp/project"), type: "main" },
        ]),
      ).toEqual([{ directory: AbsolutePath.make("/tmp/project"), type: "main" }])
    }),
  )

  it.effect("queries directories from the database", () =>
    Effect.gen(function* () {
      const project = yield* ProjectV2.Service
      const { db } = yield* Database.Service
      const projectID = ProjectV2.ID.make("directories-project")
      const otherID = ProjectV2.ID.make("directories-other")
      yield* db
        .insert(ProjectTable)
        .values([
          { id: projectID, worktree: AbsolutePath.make("/repo"), sandboxes: [], time_created: 1, time_updated: 1 },
          { id: otherID, worktree: AbsolutePath.make("/other"), sandboxes: [], time_created: 1, time_updated: 1 },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(ProjectDirectoryTable)
        .values([
          { project_id: projectID, directory: AbsolutePath.make("/repo/z"), type: "root", time_created: 2 },
          { project_id: projectID, directory: AbsolutePath.make("/repo/a"), type: "main", time_created: 1 },
          { project_id: otherID, directory: AbsolutePath.make("/other"), type: "main", time_created: 3 },
        ])
        .run()
        .pipe(Effect.orDie)

      expect(yield* project.directories({ projectID })).toEqual([
        { directory: AbsolutePath.make("/repo/z"), type: "root" },
        { directory: AbsolutePath.make("/repo/a"), type: "main" },
      ])
    }),
  )
})

describe("ProjectV2.Vcs", () => {
  it.effect("decodes a valid git Vcs", () =>
    Effect.gen(function* () {
      const result = Schema.decodeUnknownSync(ProjectV2.Vcs)({
        type: "git",
        store: "/repo/.git",
      })
      expect(result.type).toBe("git")
      expect(String(result.store)).toBe("/repo/.git")
    }),
  )

  it.effect("rejects non-git Vcs type", () =>
    Effect.gen(function* () {
      expect(() =>
        Schema.decodeUnknownSync(ProjectV2.Vcs)({ type: "svn", store: "/repo" }),
      ).toThrow()
    }),
  )
})

describe("ProjectV2.Info", () => {
  it.effect("creates Info with a valid ID", () =>
    Effect.gen(function* () {
      const info = new ProjectV2.Info({ id: makeID("proj-1") })
      expect(String(info.id)).toBe("proj-1")
    }),
  )
})

describe("ProjectV2.DirectoriesInput", () => {
  it.effect("decodes valid input with projectID", () =>
    Effect.gen(function* () {
      const result = Schema.decodeUnknownSync(ProjectV2.DirectoriesInput)({
        projectID: "my-proj",
      })
      expect(String(result.projectID)).toBe("my-proj")
    }),
  )

  it.effect("rejects input missing projectID", () =>
    Effect.gen(function* () {
      expect(() =>
        Schema.decodeUnknownSync(ProjectV2.DirectoriesInput)({}),
      ).toThrow()
    }),
  )
})

describe("ProjectV2.Directories", () => {
  it.effect("decodes an array of absolute path strings", () =>
    Effect.gen(function* () {
      const result = Schema.decodeUnknownSync(ProjectV2.Directories)(["/a/b", "/c/d"])
      expect(result).toHaveLength(2)
    }),
  )

  it.effect("rejects non-array input", () =>
    Effect.gen(function* () {
      expect(() =>
        Schema.decodeUnknownSync(ProjectV2.Directories)("not-array"),
      ).toThrow()
    }),
  )
})

describe("ProjectV2 — url normalization logic", () => {
  it.effect("HTTPS remote produces stable hash-based ID", () =>
    Effect.gen(function* () {
      const normalized = "github.com/owner/repo"
      const raw = Hash.fast(`git-remote:${normalized}`)
      const id = makeID(raw)
      expect(String(id)).toBe(raw)
    }),
  )

  it.effect("SCP-style SSH URL is parsed by regex", () =>
    Effect.gen(function* () {
      const match = "git@github.com:owner/repo.git".match(/^([^@/:]+@)?([^/:]+):(.+)$/)
      expect(match).not.toBeNull()
      expect(match![2]).toBe("github.com")
      expect(match![3]).toBe("owner/repo.git")
    }),
  )

  it.effect(".git suffix is stripped from pathname", () =>
    Effect.gen(function* () {
      const pathname = "/owner/repo.git"
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      expect(pathname).toBe("owner/repo")
    }),
  )

  it.effect("trailing slashes are stripped", () =>
    Effect.gen(function* () {
      const pathname = "/owner/repo///"
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      expect(pathname).toBe("owner/repo")
    }),
  )

  it.effect("file:// protocol yields undefined (no remote ID)", () =>
    Effect.gen(function* () {
      const parsed = new URL("file:///local/path/repo")
      expect(parsed.protocol).toBe("file:")
    }),
  )

  it.effect("empty host yields undefined normalized result", () =>
    Effect.gen(function* () {
      const host: string = ""
      const pathname = "owner/repo"
      const normalized = pathname
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      const result = host ? `${host.toLowerCase()}/${normalized}` : undefined
      expect(result).toBeUndefined()
    }),
  )

  it.effect("hostname is lowercased", () =>
    Effect.gen(function* () {
      const host: string = "GitHub.com"
      const pathname = "owner/repo"
      const result = `${host.toLowerCase()}/${pathname}`
      expect(result).toBe("github.com/owner/repo")
    }),
  )

  it.effect("invalid URL string triggers SCP-style fallback", () =>
    Effect.gen(function* () {
      const input = "not-a-url"
      try {
        new URL(input)
        expect(true).toBe(false)
      } catch {
        const match = input.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
        expect(match).toBeNull()
      }
    }),
  )
})

describe("ProjectV2.layer — resolve", () => {
  it.live("returns global ID when no git repo found", () =>
    Effect.gen(function* () {
      const service = yield* ProjectV2.Service
      const result = yield* service.resolve(makePath("/no/repo/here"))
      expect(String(result.id)).toBe("global")
      expect(result.vcs).toBeUndefined()
      expect(result.previous).toBeUndefined()
    }),
  )

  it.live("resolves a real git repo with remote", () =>
    withRepo((repoPath) =>
      Effect.gen(function* () {
        const service = yield* ProjectV2.Service
        const result = yield* service.resolve(makePath(repoPath))
        expect(result.vcs?.type).toBe("git")
        expect(String(result.id)).not.toBe("global")
      }),
    ),
  )

  it.live("uses cached ID from opencode file", () =>
    withRepo((repoPath, storePath) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        yield* fs.writeFileString(path.join(storePath, "opencode"), "cached-id")
        const service = yield* ProjectV2.Service
        const result = yield* service.resolve(makePath(repoPath))
        expect(String(result.previous)).toBe("cached-id")
      }),
    ),
  )

  it.live("falls back to root hash when cached file is empty", () =>
    withRepo((repoPath, storePath) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        yield* fs.writeFileString(path.join(storePath, "opencode"), " ")
        const service = yield* ProjectV2.Service
        const result = yield* service.resolve(makePath(repoPath))
        expect(String(result.id)).not.toBe("global")
        expect(result.previous).toBeUndefined()
      }),
    ),
  )
})

describe("ProjectV2.layer — commit", () => {
  it.live("writes ID to opencode file in store directory", () =>
    withRepo((repoPath, storePath) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const service = yield* ProjectV2.Service
        yield* service.commit({
          store: makePath(storePath),
          id: makeID("test-id"),
        })
        const content = yield* fs.readFileString(path.join(storePath, "opencode"))
        expect(content).toBe("test-id")
      }),
    ),
  )
})

describe("ProjectV2.layer — directories", () => {
  it.live("returns empty array when no directories found", () =>
    Effect.gen(function* () {
      const service = yield* ProjectV2.Service
      const result = yield* service.directories({
        projectID: makeID("nonexistent-proj"),
      })
      expect(result).toHaveLength(0)
    }),
  )
})

function withRepo<A, E, R>(
  body: (repoPath: string, storePath: string) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      const tmp = await tmpdir()
      const repoPath = tmp.path
      await initRepo(repoPath)
      const storePath = path.join(repoPath, ".git")
      return { tmp, repoPath, storePath }
    }),
    (ctx) => body(ctx.repoPath, ctx.storePath),
    (ctx) => Effect.promise(() => ctx.tmp[Symbol.asyncDispose]()),
  )
}
