export * as ProjectV2 from "./project"
export * as Project from "./project"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { makeGlobalNode } from "./effect/app-node"
import { Hash } from "./util/hash"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

const STABLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether an id is a stable minted repo identity (uuid) rather than a legacy
 * derived id (remote hash, root commit, cached value) or the global sentinel.
 */
export function isStableID(id: string) {
  return STABLE_ID_PATTERN.test(id)
}

export class Info extends Schema.Class<Info>("Project.Info")({
  id: ID,
}) {}

export const DirectoriesInput = ProjectDirectories.ListInput
export type DirectoriesInput = typeof DirectoriesInput.Type

export const Directories = ProjectDirectories.ListOutput
export type Directories = typeof Directories.Type

export interface Resolved {
  readonly previous?: ID
  readonly id: ID
  readonly directory: AbsolutePath
  readonly vcs?: Vcs
  /**
   * Repo-level grouping key shared by all clones of the same repository,
   * derived with the legacy identity algorithm (normalized remote hash,
   * falling back to root commit). Informational only — never identity.
   */
  readonly repoHash?: string
}

export interface Interface {
  readonly directories: (input: DirectoriesInput) => Effect.Effect<Directories>
  readonly resolve: (input: AbsolutePath) => Effect.Effect<Resolved>
  /**
   * Temporary bridge method for writing a project's minted identity to the
   * repo-local cache (`<commonDir>/opencode`) as versioned JSON.
   *
   * This exists while the old opencode project service and this core project
   * service work together: core resolves the ID, while the old service still owns
   * minting, database migration, and persistence. Returns whether the write
   * landed so callers only adopt a minted identity that is durably stored;
   * once project persistence moves into core, this separate bridge method can
   * go away.
   */
  readonly commit: (input: { store: AbsolutePath; id: ID; repoHash?: string }) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectV2") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const projectDirectories = yield* ProjectDirectories.Service

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const parse = (content: string): { repoID?: ID; legacy?: ID; repoHash?: string } => {
      try {
        const parsed: unknown = JSON.parse(content)
        if (parsed && typeof parsed === "object") {
          const repoID = "repoID" in parsed ? parsed.repoID : undefined
          const repoHash = "repoHash" in parsed ? parsed.repoHash : undefined
          const stored = typeof repoHash === "string" && repoHash ? repoHash : undefined
          // Forward-compatible read: honor the repoID of any structured
          // version, ignore structured content we do not understand.
          if (typeof repoID === "string" && isStableID(repoID)) return { repoID: ID.make(repoID), repoHash: stored }
          return {}
        }
      } catch {}
      // Bare string contents predate the versioned format.
      return { legacy: ID.make(content) }
    }

    const cached = Effect.fnUntraced(function* (dir: string) {
      const content = yield* fs.readFileString(path.join(dir, "opencode")).pipe(
        Effect.map((value) => value.trim()),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!content) return { repoID: undefined, legacy: undefined, repoHash: undefined }
      return parse(content)
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

    const resolve = Effect.fn("Project.resolve")(function* (input: AbsolutePath) {
      const repo = yield* git.repo.discover(input)
      if (!repo) return { id: ID.global, directory: AbsolutePath.make(path.parse(input).root), vcs: undefined }

      const vcs = { type: "git" as const, store: repo.commonDirectory }
      const stored = yield* cached(repo.commonDirectory)
      // A minted identity persisted in the versioned cache file is
      // authoritative: it is what keeps independent clones of the same
      // remote distinct while linked worktrees (shared common dir) and
      // renamed checkouts keep resolving to the same project.
      if (stored.repoID) {
        // The repo-level grouping key uses the legacy identity derivation, so
        // it stays byte-identical to pre-versioned ids: remote hash first
        // (recomputed so a remote change is picked up), then the stored key,
        // then the root commit (only computed when nothing is stored).
        const repoHash = (yield* remote(repo)) ?? stored.repoHash ?? (yield* root(repo))
        return { id: stored.repoID, directory: repo.worktree, vcs, repoHash }
      }

      const previous = stored.legacy
      const id = (yield* remote(repo)) ?? previous ?? (yield* root(repo))
      return {
        previous,
        id: id ?? ID.global,
        directory: repo.worktree,
        vcs,
        // On the legacy path the derived id is exactly the repo-level key.
        repoHash: id,
      }
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID; repoHash?: string }) {
      return yield* fs
        .writeFileString(
          path.join(input.store, "opencode"),
          JSON.stringify({ version: 1, repoID: input.id, ...(input.repoHash ? { repoHash: input.repoHash } : {}) }) +
            "\n",
        )
        .pipe(
          Effect.map(() => true),
          Effect.catch(() => Effect.succeed(false)),
        )
    })

    return Service.of({ directories, resolve, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Git.node, ProjectDirectories.node],
})
