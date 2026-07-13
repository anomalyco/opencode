import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEventLogCompaction } from "@opencode-ai/core/session/event-log-compaction"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { SessionID } from "@opencode-ai/schema/session-id"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))

describe("SessionEventLogCompaction", () => {
  it.effect("keeps replay and the message projection identical while reclaiming superseded snapshots", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const sessionID = SessionID.descending("ses_event_log_compaction")
      const messageID = SessionV1.MessageID.ascending("msg_event_log_compaction")
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "compaction",
          directory: "/project",
          title: "compaction",
          version: "test",
        })
        .run()
      const message = (agent: string) => ({
        id: messageID,
        sessionID,
        role: "user" as const,
        time: { created: 1 },
        agent,
        model: { providerID: ProviderV2.ID.make("provider"), modelID: ModelV2.ID.make("model") },
      })

      yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID, info: message("before") })
      yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID, info: message("after") })
      const projection = yield* db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get()
      const dryRun = yield* SessionEventLogCompaction.compact(db, { aggregateID: sessionID, dryRun: true })

      expect(dryRun).toMatchObject({ candidates: 1, rewritten: 0, payloadBytesReclaimed: expect.any(Number) })
      expect(projection?.data).toMatchObject({ agent: "after" })

      const applied = yield* SessionEventLogCompaction.compact(db, { aggregateID: sessionID })
      const compacted = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()

      expect(applied).toMatchObject({ candidates: 1, rewritten: 1 })
      expect(compacted.map((event) => event.seq)).toEqual([0, 1])
      expect(compacted.map((event) => event.type)).toEqual(["event.compacted.1", "message.updated.1"])
      expect(yield* db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get()).toEqual(projection)

      expect(
        yield* events.replayAll(
          compacted.map((event) => ({
            id: event.id,
            aggregateID: event.aggregate_id,
            seq: event.seq,
            type: event.type,
            data: event.data,
          })),
        ),
      ).toBe(sessionID)
    }),
  )
})
