import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Database } from "@moks/core/database/database"
import { LayerNode } from "@moks/core/effect/layer-node"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { Project } from "@moks/core/project"
import { ProjectDirectories } from "@moks/core/project/directories"
import { ProjectTable } from "@moks/core/project/sql"
import { AbsolutePath } from "@moks/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, ProjectDirectories.node])))

const projectID = Project.ID.make("project-directories")
const directory = AbsolutePath.make("/tmp/project-directories")

function setup() {
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: directory, sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie),
  )
}

describe("ProjectDirectories", () => {
  it.effect("decodes directory schemas", () =>
    Effect.sync(() => {
      expect(Schema.decodeUnknownSync(ProjectDirectories.ListInput)({ projectID })).toEqual({ projectID })
      expect(Schema.decodeUnknownSync(ProjectDirectories.ListOutput)([{ directory }])).toEqual([{ directory }])
    }),
  )

  it.effect("creates once and ignores conflicts", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* ProjectDirectories.Service

      expect(yield* service.create({ projectID, directory })).toBe(true)
      expect(yield* service.create({ projectID, directory, strategy: "git_worktree" })).toBe(false)
      expect(yield* service.list(projectID)).toEqual([{ directory, strategy: undefined }])
    }),
  )

  it.effect("replaces the strategy when requested", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* ProjectDirectories.Service
      yield* service.create({ projectID, directory, strategy: "old/strategy" })

      expect(yield* service.create({ projectID, directory, strategy: "new/strategy", behavior: "replace" })).toBe(true)
      expect(yield* service.create({ projectID, directory, strategy: "new/strategy", behavior: "replace" })).toBe(false)
      expect(yield* service.create({ projectID, directory, behavior: "replace" })).toBe(true)
      expect(yield* service.create({ projectID, directory, behavior: "replace" })).toBe(false)
      expect(yield* service.create({ projectID, directory, strategy: "new/strategy", behavior: "replace" })).toBe(true)
      expect(yield* service.list(projectID)).toEqual([{ directory, strategy: "new/strategy" }])
    }),
  )
})
