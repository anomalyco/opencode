import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Project.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

const load = (directory: AbsolutePath) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return yield* Location.Service.pipe(
      Effect.provide(locations.get(Location.Ref.make({ directory }))),
      Effect.scoped,
    )
  })

describe("Location missing project persistence", () => {
  it.live("does not persist a project row when a local directory is missing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const missing = AbsolutePath.make(path.join(dir.path, "deleted-worktree"))
      const projects = yield* Project.Service

      expect(Exit.isFailure(yield* Effect.exit(load(missing)))).toBe(true)
      expect((yield* projects.list({ archived: true })).some((item) => item.canonical === missing)).toBe(false)

      yield* Effect.promise(() => fs.mkdir(missing))
      const resolved = yield* load(missing)
      expect(resolved.project.canonical).toBe(missing)
      expect((yield* projects.list({ archived: true })).some((item) => item.id === resolved.project.id)).toBe(true)
    }),
  )

  it.live("does not unarchive a project when its removed directory is requested", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const removed = AbsolutePath.make(path.join(dir.path, "removed-project"))
      yield* Effect.promise(() => fs.mkdir(removed))
      const db = (yield* Database.Service).db
      const projects = yield* Project.Service
      const created = yield* projects.resolve(removed)

      yield* Effect.promise(() => fs.rm(removed, { recursive: true, force: true }))
      yield* db.update(ProjectTable).set({ time_archived: 1 }).where(eq(ProjectTable.id, created.id)).run()

      expect(Exit.isFailure(yield* Effect.exit(load(removed)))).toBe(true)
      const after = (yield* projects.list({ archived: true })).find((item) => item.id === created.id)
      expect(after?.time.archived).toBe(1)
    }),
  )
})
