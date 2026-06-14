import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@daemon-protocol/core/database/database"
import { EventV2 } from "@daemon-protocol/core/event"
import { Project } from "@daemon-protocol/core/project"
import { ProjectDirectories } from "@daemon-protocol/core/project/directories"
import { ProjectTable } from "@daemon-protocol/core/project/sql"
import { AbsolutePath } from "@daemon-protocol/core/schema"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const directories = ProjectDirectories.layer.pipe(Layer.provide(database), Layer.provide(events))
const it = testEffect(Layer.mergeAll(database, events, directories))

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
