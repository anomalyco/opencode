import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location({ directory: AbsolutePath.make("project"), workspaceID: WorkspaceV2.ID.make("wrk_test") }),
  ),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, Location.node]), [[Location.node, locationLayer]]),
)

const insert = (db: Database.Interface["db"]) =>
  (rows: { id: string; aggregateID: string; seq: number; type: string; data: Record<string, unknown> }[]) =>
    db
      .insert(EventTable)
      .values(
        rows.map((row) => ({
          id: row.id,
          aggregate_id: row.aggregateID,
          seq: row.seq,
          type: row.type,
          data: row.data,
        })) as never,
      )
      .run()
      .pipe(Effect.orDie)

describe("EventV2.compactSnapshotEvents", () => {
  it.effect("keeps only the latest message.updated and part.updated per entity", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.insert(EventSequenceTable).values([{ aggregate_id: "ses_a", seq: 10 }]).run().pipe(Effect.orDie)
      yield* insert(db)([
        { id: "e1", aggregateID: "ses_a", seq: 1, type: "message.updated.1", data: { info: { id: "msg_m1", text: "v1" } } },
        { id: "e9", aggregateID: "ses_a", seq: 9, type: "session.created.1", data: { sessionID: "ses_a" } },
        { id: "e10", aggregateID: "ses_a", seq: 10, type: "session.updated.1", data: { sessionID: "ses_a" } },
        { id: "e2", aggregateID: "ses_a", seq: 2, type: "message.updated.1", data: { info: { id: "msg_m1", text: "v2" } } },
        { id: "e3", aggregateID: "ses_a", seq: 3, type: "message.updated.1", data: { info: { id: "msg_m1", text: "v3" } } },
        { id: "e4", aggregateID: "ses_a", seq: 4, type: "message.updated.1", data: { info: { id: "msg_m2", text: "x" } } },
        { id: "e5", aggregateID: "ses_a", seq: 5, type: "message.part.updated.1", data: { part: { id: "prt_p1", text: "a" } } },
        { id: "e6", aggregateID: "ses_a", seq: 6, type: "message.part.updated.1", data: { part: { id: "prt_p1", text: "ab" } } },
        { id: "e7", aggregateID: "ses_a", seq: 7, type: "message.part.updated.1", data: { part: { id: "prt_p1", text: "abc" } } },
        { id: "e8", aggregateID: "ses_a", seq: 8, type: "message.removed.1", data: { sessionID: "ses_a", messageID: "msg_m9" } },
      ])

      const result = yield* EventV2.compactSnapshotEvents(db)
      expect(result.removed).toBe(4)

      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, "ses_a"))
        .all()
        .pipe(Effect.orDie)
      const updated = rows.filter((row) => row.type === "message.updated.1")
      const parts = rows.filter((row) => row.type === "message.part.updated.1")
      const removed = rows.filter((row) => row.type === "message.removed.1")
      expect(updated).toHaveLength(2)
      expect(parts).toHaveLength(1)
      const texts = updated.map((row) => (row.data as { info?: { text?: string } }).info?.text)
      expect(texts).toContain("x")
      expect(texts).toContain("v3")
      expect(removed).toHaveLength(1)
    }),
  )

  it.effect("removes nothing when no duplicate snapshots exist", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.insert(EventSequenceTable).values([{ aggregate_id: "ses_b", seq: 1 }]).run().pipe(Effect.orDie)
      yield* insert(db)([
        { id: "e1", aggregateID: "ses_b", seq: 1, type: "message.updated.1", data: { info: { id: "msg_m1", text: "only" } } },
      ])
      const result = yield* EventV2.compactSnapshotEvents(db)
      expect(result.removed).toBe(0)
    }),
  )
})