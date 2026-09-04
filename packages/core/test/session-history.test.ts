import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionHistory } from "@opencode-ai/core/session/history"
import { MessageID, PartID } from "@opencode-ai/core/v1/session"
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

const GapEvent = EventV2.define({
  type: "test.session.history.gap",
  durable: { aggregate: "sessionID", version: 1 },
  schema: { sessionID: SessionV2.ID, value: Schema.String },
})

describe("SessionV2.history", () => {
  it.effect("returns an exhausted page for a migrated Session with no event sequence", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const session = yield* SessionV2.Service
      const sessionID = SessionV2.ID.make("ses_empty_history")
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: ProjectV2.ID.global,
          slug: "empty-history",
          directory: "/project",
          title: "Empty history",
          version: "test",
        })
        .run()

      const first = yield* session.history({ sessionID, limit: 10 })

      expect(first).toEqual({ events: [], hasMore: false })
    }),
  )

  it.effect("treats after as an exclusive aggregate sequence", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* session.switchAgent({ sessionID: created.id, agent: "one" })
      yield* session.switchAgent({ sessionID: created.id, agent: "two" })

      const page = yield* session.history({ sessionID: created.id, after: 1, limit: 10 })

      expect(page.events.map((event) => event.durable?.seq)).toEqual([2])
      expect(page.hasMore).toBe(false)
    }),
  )

  it.effect("paginates public events in aggregate order across filtered gaps without duplicates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })
      yield* session.switchAgent({ sessionID: created.id, agent: "one" })
      yield* events.publish(GapEvent, { sessionID: created.id, value: "filtered" })
      yield* session.switchAgent({ sessionID: created.id, agent: "two" })
      yield* session.switchAgent({ sessionID: created.id, agent: "three" })

      const first = yield* session.history({ sessionID: created.id, limit: 2 })
      const after = first.events.at(-1)?.durable?.seq
      const second = yield* session.history({
        sessionID: created.id,
        after,
        limit: 2,
      })
      const sequence = [...first.events, ...second.events].map((event) => event.durable?.seq)

      expect(first.hasMore).toBe(true)
      expect(second.hasMore).toBe(false)
      expect(sequence).toEqual([1, 3, 4])
      expect(new Set(sequence).size).toBe(sequence.length)
    }),
  )

  it.effect("includes events committed between pages", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* session.switchAgent({ sessionID: created.id, agent: "one" })
      yield* session.switchAgent({ sessionID: created.id, agent: "two" })

      const first = yield* session.history({ sessionID: created.id, limit: 1 })
      yield* session.switchAgent({ sessionID: created.id, agent: "later" })
      const second = yield* session.history({
        sessionID: created.id,
        after: first.events.at(-1)?.durable?.seq,
        limit: 10,
      })

      expect(first.hasMore).toBe(true)
      expect([...first.events, ...second.events].map((event) => event.durable?.seq)).toEqual([1, 2, 3])
      expect(second.hasMore).toBe(false)
    }),
  )

  it.effect("reports exhaustion for exact-limit and limit-plus-one pages", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* session.switchAgent({ sessionID: created.id, agent: "one" })
      yield* session.switchAgent({ sessionID: created.id, agent: "two" })

      const exact = yield* session.history({ sessionID: created.id, limit: 2 })
      const oneMore = yield* session.history({ sessionID: created.id, limit: 1 })
      const exhausted = yield* session.history({
        sessionID: created.id,
        after: oneMore.events.at(-1)?.durable?.seq,
        limit: 1,
      })

      expect(exact.events).toHaveLength(2)
      expect(exact.hasMore).toBe(false)
      expect(oneMore.events).toHaveLength(1)
      expect(oneMore.hasMore).toBe(true)
      expect(exhausted.events).toHaveLength(1)
      expect(exhausted.hasMore).toBe(false)
    }),
  )

  it.effect("fails with NotFoundError for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const error = yield* session.history({ sessionID: SessionV2.ID.make("ses_missing"), limit: 10 }).pipe(Effect.flip)

      expect(error._tag).toBe("Session.NotFoundError")
    }),
  )

  it.effect("loads V1 history for runner when session_message table has no rows", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const sessionID = SessionV2.ID.make("ses_v1_legacy_test")
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: ProjectV2.ID.global,
          slug: "v1-legacy-test",
          directory: "/project",
          title: "V1 Legacy Test",
          version: "1",
        })
        .run()

      const userMsgId = MessageID.make("msg_user_1")
      yield* db
        .insert(MessageTable)
        .values({
          id: userMsgId,
          session_id: sessionID,
          time_created: 1000,
          time_updated: 1000,
          data: {
            role: "user",
            time: { created: 1000 },
          } as any,
        })
        .run()

      yield* db
        .insert(PartTable)
        .values({
          id: PartID.make("prt_user_txt"),
          message_id: userMsgId,
          session_id: sessionID,
          time_created: 1000,
          time_updated: 1000,
          data: {
            type: "text",
            text: "Fix the queue bug",
          } as any,
        })
        .run()

      const asstMsgId = MessageID.make("msg_asst_1")
      yield* db
        .insert(MessageTable)
        .values({
          id: asstMsgId,
          session_id: sessionID,
          time_created: 2000,
          time_updated: 2000,
          data: {
            role: "assistant",
            agent: "build",
            modelID: "claude-sonnet",
            providerID: "anthropic",
            time: { created: 2000, completed: 2500 },
          } as any,
        })
        .run()

      yield* db
        .insert(PartTable)
        .values([
          {
            id: PartID.make("prt_asst_txt"),
            message_id: asstMsgId,
            session_id: sessionID,
            time_created: 2000,
            time_updated: 2000,
            data: {
              type: "text",
              text: "Running tests now.",
            } as any,
          },
          {
            id: PartID.make("prt_asst_tool"),
            message_id: asstMsgId,
            session_id: sessionID,
            time_created: 2100,
            time_updated: 2100,
            data: {
              type: "tool",
              tool: "bash",
              callID: "call_test_1",
              state: {
                status: "completed",
                input: { command: "bun test" },
                output: "FAIL: 6 tests failed",
              },
            } as any,
          },
        ])
        .run()

      const entries = yield* SessionHistory.entriesForRunner(db, sessionID, 0)
      expect(entries).toHaveLength(2)
      expect(entries[0].message.type).toBe("user")
      if (entries[0].message.type === "user") {
        expect(entries[0].message.text).toBe("Fix the queue bug")
      }
      expect(entries[1].message.type).toBe("assistant")
      if (entries[1].message.type === "assistant") {
        expect(entries[1].message.content).toHaveLength(2)
        expect(entries[1].message.content[0].type).toBe("text")
        expect(entries[1].message.content[1].type).toBe("tool")
      }
    }),
  )
})
