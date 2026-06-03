import { describe, expect } from "bun:test"
import { $ } from "bun"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Hash } from "@opencode-ai/core/util/hash"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Project } from "@/project/project"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Project.defaultLayer, Database.defaultLayer, CrossSpawnSpawner.defaultLayer))

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
            .map((row) => ({ directory: row.directory, type: row.type }))
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

      expect(yield* directories(result.project.id)).toEqual([{ directory: tmp, type: "main" }])
    }),
  )

  it.live("stores a repeatedly opened checkout directory only once", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(tmp)
      const next = yield* project.fromDirectory(tmp)

      expect(next.project.id).toBe(result.project.id)
      expect(yield* directories(result.project.id)).toEqual([{ directory: tmp, type: "main" }])
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
          { directory: tmp, type: "main" as const },
          { directory: worktree, type: "git_worktree" as const },
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

      expect(yield* directories(result.project.id)).toEqual([{ directory: worktree, type: "git_worktree" }])
    }),
  )

  it.live("stores a separately opened clone as a secondary directory", () =>
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

      yield* project.fromDirectory(clone)

      expect(yield* directories(main.project.id)).toEqual(
        [
          { directory: tmp, type: "main" as const },
          { directory: clone, type: "root" as const },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
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

      expect(yield* directories(result.project.id)).toEqual([{ directory: worktree, type: "git_worktree" }])
    }),
  )

  it.live("records the active directory under its newly resolved project id", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      yield* project.fromDirectory(tmp)
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

      yield* project.fromDirectory(tmp)

      expect(yield* directories(remoteID)).toEqual([{ directory: tmp, type: "main" }])
    }),
  )
})
