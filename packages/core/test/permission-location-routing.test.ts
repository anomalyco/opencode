import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Permission } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import type { Session } from "@opencode-ai/schema/session"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { permissionForSession } from "@opencode-ai/core/plugin/permission"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionStore.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

const sesB = "ses_perm_loc_b" as Session.ID
const sesMissing = "ses_perm_loc_missing" as Session.ID
const reqID = Permission.ID.create("per_perm_loc_routed")

/** A real scratch directory with a planted (empty) project config. */
const scratch = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
).pipe(
  Effect.flatMap((dir) =>
    Effect.promise(async () => {
      await fs.writeFile(path.join(dir.path, "opencode.json"), "{}")
      return Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    }),
  ),
)

describe("permissionForSession", () => {
  it.live("replies through the session's own location instance", () =>
    Effect.gen(function* () {
      const refA = yield* scratch
      const refB = yield* scratch
      const locations = yield* LocationServiceMap.Service
      const inScope = <A, E, R>(ref: Location.Ref, effect: Effect.Effect<A, E, R>) =>
        Effect.provide(effect, locations.get(ref))

      // The session lives in location B: seed its row plus an empty ruleset
      // (no matching rule evaluates to "ask") and leave one request pending.
      const setup = Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: refB.directory, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values({
            id: sesB,
            project_id: Project.ID.global,
            slug: "permission-routing",
            directory: refB.directory,
            title: "permission routing",
            version: "test",
            agent: "test",
          })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const agents = yield* Agent.Service
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make("test"), (agent) => {
            agent.permissions = []
          }),
        )
        const permission = yield* Permission.Service
        const asked = yield* permission.ask({
          id: reqID,
          sessionID: sesB,
          action: "read",
          resources: ["src/index.ts"],
        })
        expect(asked.effect).toBe("ask")
        return permission
      })
      const permB = yield* inScope(refB, setup)
      const permA = yield* inScope(refA, Effect.gen(function* () {
        return yield* Permission.Service
      }))

      // The ambient (plugin-location) instance cannot see the request: this is
      // the shape of the Telegram "Permission request not found" failure.
      expect(yield* permA.get(reqID)).toBeUndefined()

      const store = yield* SessionStore.Service
      const sessions = {
        get: (id: Session.ID) =>
          Effect.flatMap(store.get(id), (session) =>
            session === undefined
              ? Effect.fail(new Error(`Session not found: ${id}`))
              : Effect.succeed({ location: session.location }),
          ),
      }
      const scoped = (ref: Location.Ref) =>
        Effect.gen(function* () {
          return yield* Permission.Service
        }).pipe(
          Effect.provide(locations.get(ref)),
          Effect.orDie,
        )

      yield* permissionForSession({
        sessions,
        scoped,
        ambient: permA,
        sessionID: sesB,
        use: (permission) => permission.reply({ requestID: reqID, reply: "reject" }),
      })
      expect(yield* permB.get(reqID)).toBeUndefined()
      expect(yield* permB.list()).toEqual([])

      // Unknown sessions fall back to the ambient instance without throwing.
      const missing = yield* permissionForSession({
        sessions,
        scoped,
        ambient: permA,
        sessionID: sesMissing,
        use: (permission) => permission.get(reqID),
      })
      expect(missing).toBeUndefined()
    }),
  )
})
