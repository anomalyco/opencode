export * as Project from "./project.js"

import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { and, asc, desc, eq } from "drizzle-orm"
import path from "path"
import { AbsolutePath } from "./schema.js"
import { Bus } from "./bus.js"
import { Database } from "./database/database.js"
import { Worktree } from "@opencode-ai/schema/worktree"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Git } from "./git.js"
import { AppProcess } from "@opencode-ai/util/process"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Hash } from "@opencode-ai/util/hash"
import { ProjectSchema } from "./project/schema.js"
import { ProjectTable, upsertProject } from "./project/sql.js"
import { WorktreeTable } from "./worktree/sql.js"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export const Current = ProjectSchema.Current
export type Current = ProjectSchema.Current

export const Info = ProjectSchema.Info
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const UpdateInput = ProjectSchema.UpdateInput
export type UpdateInput = typeof UpdateInput.Type

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Project.NotFoundError", {
  projectID: ID,
}) {}

export interface Resolved {
  readonly previous?: ID
  readonly id: ID
  readonly directory: AbsolutePath
  readonly canonical: AbsolutePath
  readonly vcs?: Vcs
}

// Keep this filesystem-only; permission checks use it and should not execute VCS commands.
export const root = Effect.fn("Project.root")(function* (fs: FSUtil.Interface, input: AbsolutePath) {
  return yield* fs.up({ targets: [".git", ".hg"], start: input, mode: "first" }).pipe(
    Effect.map((matches) => (matches[0] ? AbsolutePath.make(path.dirname(matches[0])) : undefined)),
    Effect.orElseSucceed(() => undefined),
  )
})

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly resolve: (input: AbsolutePath) => Effect.Effect<Resolved>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Project") {}

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
    canonical: row.worktree,
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
    const bus = yield* Bus.Service
    const db = (yield* Database.Service).db

    const announcing = new Set<string>()
    const persist = Effect.fnUntraced(function* (project: Resolved) {
      yield* upsertProject(db, project).pipe(Effect.orDie)
      if (!project.vcs) return project
      const directories: Array<{ projectID: ID; directory: AbsolutePath; strategy?: string }> = [
        { projectID: project.id, directory: project.canonical },
      ]
      if (project.directory !== project.canonical)
        directories.push({
          projectID: project.id,
          directory: project.directory,
          strategy: project.vcs.type === "git" ? "git" : undefined,
        })
      // A missing directory row means this directory's resolution is a new durable
      // fact (copy.ts registers copy directories directly; those never strand
      // sessions and never announce). The row insert commits atomically with the
      // event, so a crash between checks retries on the next resolve instead of
      // stranding the announcement. The in-flight set keeps concurrent resolves
      // from publishing the same fact twice.
      for (const item of directories) {
        const key = item.projectID + "\u0000" + item.directory
        if (announcing.has(key)) continue
        announcing.add(key)
        yield* Effect.gen(function* () {
          const stored = yield* db
            .select({ directory: WorktreeTable.directory })
            .from(WorktreeTable)
            .where(and(eq(WorktreeTable.project_id, item.projectID), eq(WorktreeTable.directory, item.directory)))
            .get()
            .pipe(Effect.orDie)
          if (stored) return
          yield* bus.publish(
            Worktree.Event.Resolved,
            { projectID: item.projectID, directory: item.directory, previous: project.previous ?? ID.global },
            {
              commit: () =>
                db
                  .insert(WorktreeTable)
                  .values({ project_id: item.projectID, directory: item.directory, strategy: item.strategy })
                  .onConflictDoNothing()
                  .run()
                  .pipe(Effect.orDie, Effect.asVoid),
            },
          )
        }).pipe(Effect.ensuring(Effect.sync(() => announcing.delete(key))))
      }
      return project
    })

    const list = Effect.fn("Project.list")(function* () {
      const rows = yield* db
        .select()
        .from(ProjectTable)
        .orderBy(desc(ProjectTable.time_updated), asc(ProjectTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const row = yield* db
        .update(ProjectTable)
        .set({
          name: input.name,
          icon_url: input.icon?.url,
          icon_url_override: input.icon?.override,
          icon_color: input.icon?.color,
          commands: input.commands,
          time_updated: Date.now(),
        })
        .where(eq(ProjectTable.id, input.projectID))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ projectID: input.projectID })
      const result = fromRow(row)
      yield* bus.publish(ProjectSchema.Event.Updated, result)
      return result
    })

    const cached = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(path.join(dir, "opencode")).pipe(
        Effect.map((value) => value.trim()),
        Effect.map((value) => (value ? ID.make(value) : undefined)),
        Effect.orElseSucceed(() => undefined),
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

    const rootCommit = Effect.fnUntraced(function* (repo: Git.Repository) {
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
        .pipe(Effect.orElseSucceed(() => undefined))
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
      const dotHg = yield* fs.up({ targets: [".hg"], start: input, mode: "first" }).pipe(
        Effect.map((matches) => matches[0]),
        Effect.orElseSucceed(() => undefined),
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
        const id = (yield* remote(repo)) ?? previous ?? (yield* rootCommit(repo))
        const canonical =
          repo.gitDirectory === repo.commonDirectory
            ? repo.worktree
            : yield* git.worktree.list(repo).pipe(
                Effect.map((items) => items.find((item) => item.kind === "main")?.directory ?? repo.worktree),
                Effect.orElseSucceed(() => repo.worktree),
              )
        return yield* persist({
          previous,
          id: id ?? ID.global,
          directory: repo.worktree,
          canonical,
          vcs: { type: "git" as const, store: repo.commonDirectory },
        })
      }

      const hg = yield* hgDiscover(input)
      if (hg) return yield* persist({ ...hg, canonical: hg.directory })
      const directory = AbsolutePath.make(path.parse(input).root)
      return yield* persist({ id: ID.global, directory, canonical: directory, vcs: undefined })
    })

    return Service.of({ list, resolve, update })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Bus.node, Database.node, FSUtil.node, Git.node, AppProcess.node],
})
