export * as ProjectV2 from "./project"
export * as Project from "./project"

import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { asc, desc } from "drizzle-orm"
import path from "path"
import { AbsolutePath } from "./schema"
import { Database } from "./database/database"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { AppProcess } from "./process"
import { makeGlobalNode } from "./effect/app-node"
import { Hash } from "./util/hash"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"
import { ProjectTable } from "./project/sql"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export const Current = ProjectSchema.Current
export type Current = ProjectSchema.Current

export const Directory = ProjectSchema.Directory
export type Directory = ProjectSchema.Directory

export const Info = ProjectSchema.Info
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const DirectoriesInput = ProjectSchema.DirectoriesInput
export type DirectoriesInput = typeof DirectoriesInput.Type

export const Directories = ProjectSchema.Directories
export type Directories = typeof Directories.Type

export interface Resolved {
  readonly previous?: ID
  readonly id: ID
  readonly directory: AbsolutePath
  readonly vcs?: Vcs
}

// Keep this filesystem-only; permission checks use it and should not execute VCS commands.
export const root = Effect.fn("Project.root")(function* (
  fs: FSUtil.Interface,
  input: AbsolutePath,
) {
  return yield* fs.up({ targets: [".git", ".hg"], start: input }).pipe(
    Effect.map((matches) => matches[0] ? AbsolutePath.make(path.dirname(matches[0])) : undefined),
    Effect.catch(() => Effect.succeed(undefined)),
  )
})

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly directories: (input: DirectoriesInput) => Effect.Effect<Directories>
  readonly resolve: (input: AbsolutePath) => Effect.Effect<Resolved>
  /**
   * Temporary bridge method for writing the resolved project ID to the repo-local cache.
   *
   * This exists while the old opencode project service and this core project
   * service work together: core resolves the ID, while the old service still owns
   * database migration and persistence. The old service should call this after it
   * finishes migrating from `resolve().previous` to `resolve().id`; once project
   * persistence moves into core, this separate bridge method can go away.
   */
  readonly commit: (input: { store: AbsolutePath; id: ID }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectV2") {}

function fromRow(row: typeof ProjectTable.$inferSelect): Info {
  const icon =
    row.icon_url || row.icon_url_override || row.icon_color
      ? {
          url: row.icon_url ?? undefined,
          override: row.icon_url_override ?? undefined,
          color: row.icon_color ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ?? undefined,
    name: row.name ?? undefined,
    icon,
    commands: row.commands ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const proc = yield* AppProcess.Service
    const db = (yield* Database.Service).db
    const projectDirectories = yield* ProjectDirectories.Service

    const list = Effect.fn("Project.list")(function* () {
      const rows = yield* db
        .select()
        .from(ProjectTable)
        .orderBy(desc(ProjectTable.time_updated), asc(ProjectTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const cached = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(path.join(dir, "opencode")).pipe(
        Effect.map((value) => value.trim()),
        Effect.map((value) => (value ? ID.make(value) : undefined)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
    })

    const remote = Effect.fnUntraced(function* (repo: Git.Repository) {
      const origin = yield* git.remote.get(repo)
      if (!origin) return undefined
      const normalized = url(origin)
      if (!normalized) return undefined
      return ID.make(Hash.fast(`git-remote:${normalized}`))
    })

    function url(input: string) {
      const value = input.trim()
      if (!value) return undefined

      try {
        const parsed = new URL(value)
        if (parsed.protocol === "file:") return undefined
        return parts(parsed.hostname, parsed.pathname)
      } catch {
        const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
        if (scp) return parts(scp[2], scp[3])
        return undefined
      }
    }

    function parts(host: string, name: string) {
      const pathname = name
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      if (!host || !pathname) return undefined
      return `${host.toLowerCase()}/${pathname}`
    }

    const root = Effect.fnUntraced(function* (repo: Git.Repository) {
      const root = (yield* git.history.rootCommits(repo))[0]
      return root ? ID.make(root) : undefined
    })

    // Mercurial identity uses the cached ID or the first root changeset; remote-derived
    // identity (the git `remote()` path) is a follow-up.
    const hgRoot = Effect.fnUntraced(function* (worktree: AbsolutePath) {
      const result = yield* proc
        .run(
          ChildProcess.make("hg", ["log", "-r", "roots(all())", "-T", "{node}\n"], {
            cwd: worktree,
            env: { HGPLAIN: "1" },
            extendEnv: true,
            stdin: "ignore",
          }),
        )
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result || result.exitCode !== 0) return undefined
      const node = result.stdout
        .toString("utf8")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
        .toSorted()[0]
      return node ? ID.make(node) : undefined
    })

    const hgDiscover = Effect.fnUntraced(function* (input: AbsolutePath) {
      const dotHg = yield* fs.up({ targets: [".hg"], start: input }).pipe(
        Effect.map((matches) => matches[0]),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!dotHg) return undefined
      const worktree = AbsolutePath.make(path.dirname(dotHg))
      const store = AbsolutePath.make(dotHg)
      const previous = yield* cached(store)
      const id = previous ?? (yield* hgRoot(worktree))
      return {
        previous,
        id: id ?? ID.global,
        directory: worktree,
        vcs: { type: "hg" as const, store },
      }
    })

    const resolve = Effect.fn("Project.resolve")(function* (input: AbsolutePath) {
      const repo = yield* git.repo.discover(input)
      if (repo) {
        const previous = yield* cached(repo.commonDirectory)
        const id = (yield* remote(repo)) ?? previous ?? (yield* root(repo))
        return {
          previous,
          id: id ?? ID.global,
          directory: repo.worktree,
          vcs: { type: "git" as const, store: repo.commonDirectory },
        }
      }

      const hg = yield* hgDiscover(input)
      if (hg) return hg
      return { id: ID.global, directory: AbsolutePath.make(path.parse(input).root), vcs: undefined }
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      yield* fs.writeFileString(path.join(input.store, "opencode"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ list, directories, resolve, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Database.node, FSUtil.node, Git.node, AppProcess.node, ProjectDirectories.node],
})
