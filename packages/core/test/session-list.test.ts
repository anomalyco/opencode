import { describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const legacyDirectory =
  "http://localhost:3333/L2hvbWUvamFuL3Byb2plY3RzL2hpcHBvY2FjdHVz/session/ses_13416c6c1ffeuwjo0B1mxirCjT"

describe("SessionV2.list", () => {
  it.effect("lists a legacy session whose stored directory is not a filesystem path", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      // Older web builds stored the session's own URL in `directory`, which the column's write
      // path rejects now, so the value is planted directly.
      const { db } = yield* Database.Service
      yield* db.run(sql`UPDATE session SET directory = ${legacyDirectory} WHERE id = ${created.id}`)

      const listed = yield* session.list()
      expect(listed).toHaveLength(1)
      expect(listed[0].id).toBe(created.id)
      expect(listed[0].location.directory).toBe(AbsolutePath.make(legacyDirectory))
    }),
  )

  it.effect("rejects a directory that is not a filesystem path", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const exit = yield* session
        .create({ location: Location.Ref.make({ directory: AbsolutePath.make(legacyDirectory) }) })
        .pipe(Effect.exit)

      expect(String(exit)).toContain(`Path is not absolute: ${legacyDirectory}`)
    }),
  )
})
