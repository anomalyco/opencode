import { Database } from "@opencode-ai/core/database/database"
import { Project } from "@opencode-ai/core/project"
import { upsertProject } from "@opencode-ai/core/project/sql"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Effect, Layer } from "effect"

export const globalProjectNode = makeGlobalNode({
  service: Project.Service,
  layer: Layer.effect(
    Project.Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      return Project.Service.of({
        list: () => Effect.succeed([]),
        update: () => Effect.die("not implemented"),
        resolve: (directory) => {
          const project = { id: Project.ID.global, directory, canonical: directory }
          return upsertProject(database.db, project).pipe(Effect.orDie, Effect.as(project))
        },
      })
    }),
  ),
  deps: [Database.node],
})
