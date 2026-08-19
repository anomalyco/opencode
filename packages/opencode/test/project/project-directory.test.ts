import { describe, expect } from "bun:test"
import { $ } from "bun"
import path from "path"
import { eq } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect } from "effect"
import { Hash } from "@opencode-ai/core/util/hash"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Project } from "@/project/project"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])))

function directories(projectID: ProjectV2.ID) {
  return Database.Service.use(({ db }) =>
    db
      .select()
      .from(ProjectDirectoryTable)
      .where(eq(ProjectDirectoryTable.project_id, projectID))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows
            .map((row) => ({ directory: row.directory, strategy: row.strategy ?? undefined }))
            .toSorted((a, b) => a.directory.localeCompare(b.directory)),
        ),
      ),
  )
}

describe("Project directory persistence", () => {
  it.live("stores the first opened checkout directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(tmp)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(tmp), strategy: undefined },
      ])
    }),
  )

  it.live("stores a repeatedly opened checkout directory only once", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(tmp)
      const next = yield* project.fromDirectory(tmp)

      expect(next.project.id).toBe(result.project.id)
      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(tmp), strategy: undefined },
      ])
    }),
  )

  it.live("stores an opened linked worktree directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-worktree")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove ${worktree}`.cwd(tmp).quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add ${worktree} -b project-directory-${Date.now()}`.cwd(tmp).quiet())

      yield* project.fromDirectory(worktree)

      expect(yield* directories(main.project.id)).toEqual(
        [
          { directory: AbsolutePath.make(tmp), strategy: undefined },
          { directory: AbsolutePath.make(worktree), strategy: undefined },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
    }),
  )

  it.live("stores only the linked copy when first opened from an external linked worktree", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-first-worktree")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove ${worktree}`.cwd(tmp).quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${worktree} HEAD`.cwd(tmp).quiet())
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(worktree)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(worktree), strategy: undefined },
      ])
    }),
  )

  it.live("stores a separately opened clone under its own project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const bare = tmp + "-project-directory-bare"
      const clone = tmp + "-project-directory-clone"
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bare} ${clone}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git clone --bare ${tmp} ${bare}`.quiet())
      yield* Effect.promise(() => $`git clone ${bare} ${clone}`.quiet())
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)

      const second = yield* project.fromDirectory(clone)

      expect(second.project.id).not.toBe(main.project.id)
      expect(yield* directories(main.project.id)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
      expect(yield* directories(second.project.id)).toEqual([
        { directory: AbsolutePath.make(clone), strategy: undefined },
      ])
    }),
  )

  it.live("stores only the materialized worktree for a bare repository", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const bare = tmp + "-project-directory-bare-store.git"
      const worktree = tmp + "-project-directory-bare-worktree"
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bare} ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git clone --bare ${tmp} ${bare}`.quiet())
      yield* Effect.promise(() => $`git worktree add ${worktree} HEAD`.cwd(bare).quiet())
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(worktree)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(worktree), strategy: undefined },
      ])
    }),
  )

  it.live("keeps recording the active directory under its minted id when an origin appears", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const first = yield* project.fromDirectory(tmp)
      const remoteID = ProjectV2.ID.make(Hash.fast("git-remote:github.com/project-directory-test/collision"))
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: remoteID,
          worktree: AbsolutePath.make("/tmp/existing"),
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [],
        })
        .run()
        .pipe(Effect.orDie)
      yield* Effect.promise(() =>
        $`git remote add origin git@github.com:project-directory-test/collision.git`.cwd(tmp).quiet(),
      )

      const next = yield* project.fromDirectory(tmp)

      expect(next.project.id).toBe(first.project.id)
      expect(yield* directories(first.project.id)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
      expect(yield* directories(remoteID)).toEqual([])
    }),
  )

  it.live("clears stale directories when a legacy project id is re-minted", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const remoteID = ProjectV2.ID.make(Hash.fast("git-remote:github.com/project-directory-test/migration"))
      const stale = AbsolutePath.make(tmp + "-stale-checkout")
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: remoteID,
          worktree: AbsolutePath.make(tmp),
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [],
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(ProjectDirectoryTable)
        .values({ project_id: remoteID, directory: stale })
        .run()
        .pipe(Effect.orDie)
      yield* Effect.promise(() =>
        $`git remote add origin git@github.com:project-directory-test/migration.git`.cwd(tmp).quiet(),
      )

      const result = yield* project.fromDirectory(tmp)

      expect(result.project.id).not.toBe(remoteID)
      expect(yield* directories(remoteID)).toEqual([])
      expect(yield* directories(result.project.id)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
    }),
  )
})
