import { describe, expect } from "bun:test"
import { Effect, Layer, RcMap, Scope } from "effect"
import { sql } from "drizzle-orm"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Instance } from "@opencode/core/instance/service"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionEnvironment } from "@opencode/core/session/environment"
import { LocationServiceMap } from "@opencode/core/location-services"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"

const closed: Session.ID[] = []
const transportScopes = new Set<Scope.Scope>()
const transport = Layer.effect(
  SessionModelTransport.Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    transportScopes.add(scope)
    yield* Effect.addFinalizer(() => Effect.sync(() => transportScopes.delete(scope)))
    return SessionModelTransport.Service.of({
      bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
      close: (sessionID) => Effect.sync(() => closed.push(sessionID)),
      closeAll: Effect.void,
    })
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionEnvironment.node,
      Session.node,
      Instance.node,
      LocationServiceMap.node,
    ]),
    [
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      SessionModelTransport.node.replace(transport),
      offlineModels,
    ],
  ),
)

describe("Session.remove", () => {
  it.effect("removes a session and its children", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(temporary.path) })
      const session = yield* Session.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })
      yield* session.environment({ sessionID: parent.id, variables: { SESSION_ENV: "parent" } })
      yield* session.environment({ sessionID: child.id, variables: { SESSION_ENV: "child" } })
      const locations = yield* LocationServiceMap.Service
      yield* Effect.acquireRelease(locations.contextEffect(location), () => locations.invalidate(location))
      closed.length = 0

      yield* session.remove(parent.id)

      expect((yield* session.list()).data).toEqual([])
      expect(closed).toEqual([parent.id, child.id])
      const environments = yield* SessionEnvironment.Service
      expect(yield* environments.get(parent.id)).toBeUndefined()
      expect(yield* environments.get(child.id)).toBeUndefined()
      expect(yield* Effect.result(session.get(parent.id))).toMatchObject({ _tag: "Failure" })
      expect(yield* Effect.result(session.get(child.id))).toMatchObject({ _tag: "Failure" })
    }),
  )

  it.live("removes unloaded sessions and children without initializing an instance", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const parent = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(temporary.path) }),
      })
      const child = yield* sessions.create({ parentID: parent.id })
      closed.length = 0
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])

      yield* sessions.remove(parent.id)

      expect(closed).toEqual([parent.id, child.id])
      expect(transportScopes.size).toBe(1)
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])
      expect((yield* sessions.list()).data).toEqual([])
    }),
  )

  it.effect("fails when the session does not exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing")

      expect(yield* Effect.result(session.remove(sessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "Session.NotFoundError", sessionID },
      })
    }),
  )

  it.effect("removes legacy V1 rows left behind by the V1→V2 migration", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(temporary.path) })
      const session = yield* Session.Service
      const db = (yield* Database.Service).db
      // Reproduce the V1→V2-migrated shape: the legacy store (as created by the
      // 20260127222353 migration) survives alongside session_v2. Fresh bootstrap
      // databases never create it, so the test materializes it explicitly.
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS session (
          id text PRIMARY KEY,
          project_id text NOT NULL,
          parent_id text,
          slug text NOT NULL,
          directory text NOT NULL,
          title text NOT NULL,
          version text NOT NULL,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          CONSTRAINT fk_session_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES project (id) ON DELETE CASCADE
        )
      `)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS message (
          id text PRIMARY KEY,
          session_id text NOT NULL,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          data text NOT NULL,
          CONSTRAINT fk_message_session_id_session_id_fk FOREIGN KEY (session_id) REFERENCES session (id) ON DELETE CASCADE
        )
      `)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS part (
          id text PRIMARY KEY,
          message_id text NOT NULL,
          session_id text NOT NULL,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          data text NOT NULL,
          CONSTRAINT fk_part_message_id_message_id_fk FOREIGN KEY (message_id) REFERENCES message (id) ON DELETE CASCADE
        )
      `)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS todo (
          session_id text NOT NULL,
          content text NOT NULL,
          status text NOT NULL,
          priority text NOT NULL,
          position integer NOT NULL,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          CONSTRAINT todo_pk PRIMARY KEY (session_id, position),
          CONSTRAINT fk_todo_session_id_session_id_fk FOREIGN KEY (session_id) REFERENCES session (id) ON DELETE CASCADE
        )
      `)
      const migrated = yield* session.create({ location })
      yield* db.run(sql`
        INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        SELECT id, project_id, slug, directory, coalesce(title, ''), version, time_created, time_updated
        FROM session_v2 WHERE id = ${migrated.id}
      `)
      yield* db.run(sql`
        INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_legacy_1', ${migrated.id}, 0, 0, '{}')
      `)
      yield* db.run(sql`
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('part_legacy_1', 'msg_legacy_1', ${migrated.id}, 0, 0, '{}')
      `)
      yield* db.run(sql`
        INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
        VALUES (${migrated.id}, 'legacy', 'pending', 'high', 0, 0, 0)
      `)

      yield* session.remove(migrated.id)

      expect((yield* session.list()).data).toEqual([])
      expect((yield* db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM session WHERE id = ${migrated.id}`))?.value).toBe(0)
      expect((yield* db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM message WHERE session_id = ${migrated.id}`))?.value).toBe(0)
      expect((yield* db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM part WHERE session_id = ${migrated.id}`))?.value).toBe(0)
      expect((yield* db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM todo WHERE session_id = ${migrated.id}`))?.value).toBe(0)
    }),
  )
})
