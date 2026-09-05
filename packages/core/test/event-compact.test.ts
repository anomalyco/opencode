import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionID } from "@opencode-ai/schema/session-id"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location({ directory: AbsolutePath.make("project"), workspaceID: WorkspaceV2.ID.make("wrk_test") }),
  ),
)

const Compactable = EventV2.define({
  type: "test.compactable",
  durable: { aggregate: "sessionID", version: 1, compact: "$.info.id" },
  schema: {
    sessionID: SessionID,
    info: Schema.Struct({ id: Schema.String, text: Schema.String }),
  },
})

const Plain = EventV2.define({
  type: "test.plain",
  durable: { aggregate: "sessionID", version: 1 },
  schema: {
    sessionID: SessionID,
    text: Schema.String,
  },
})

const sessionInfo = (id: SessionID, title: string) => ({
  id,
  slug: "test",
  projectID: ProjectV2.ID.global,
  directory: "/project",
  title,
  version: "test",
  time: { created: 1, updated: 1 },
})

describe("EventV2 compaction", () => {
  const it = testEffect(
    AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, Location.node]), [
      [Location.node, locationLayer],
    ]),
  )

  it.effect("keeps only the latest snapshot per entity when compact is set", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = SessionID.make("ses_compact_1")

      const first = yield* events.publish(Compactable, {
        sessionID: aggregateID,
        info: { id: "msg_1", text: "first" },
      })
      const second = yield* events.publish(Compactable, {
        sessionID: aggregateID,
        info: { id: "msg_1", text: "second" },
      })
      const other = yield* events.publish(Compactable, {
        sessionID: aggregateID,
        info: { id: "msg_2", text: "other" },
      })
      const unrelated = yield* events.publish(Plain, { sessionID: aggregateID, text: "unrelated" })

      expect(second.durable?.seq).toBe(first.durable!.seq + 1)
      expect(other.durable!.seq).toBe(second.durable!.seq + 1)
      expect(unrelated.durable!.seq).toBe(other.durable!.seq + 1)

      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .pipe(Effect.orDie)

      const byType = (type: string) => rows.filter((row) => row.type === type)
      const decodeId = (row: (typeof rows)[number]) =>
        (Schema.decodeUnknownSync(Compactable.data)(row.data) as { info: { id: string } }).info.id
      expect(byType("test.compactable.1").map((row) => row.seq)).toEqual([second.durable!.seq, other.durable!.seq])
      expect(byType("test.compactable.1").map(decodeId)).toEqual(["msg_1", "msg_2"])
      expect(byType("test.plain.1").map((row) => row.seq)).toEqual([unrelated.durable!.seq])
    }),
  )

  it.effect("compacts real session.updated snapshots down to the latest per session", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = SessionID.make("ses_compact_3")

      yield* events.publish(SessionV1.Event.Updated, { sessionID: aggregateID, info: sessionInfo(aggregateID, "one") })
      yield* events.publish(SessionV1.Event.Updated, { sessionID: aggregateID, info: sessionInfo(aggregateID, "two") })
      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: aggregateID,
        info: sessionInfo(aggregateID, "three"),
      })

      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .pipe(Effect.orDie)

      const titles = rows.map((row) => (Schema.decodeUnknownSync(SessionV1.Event.Updated.data)(row.data) as { info: { title: string } }).info.title)
      expect(titles).toEqual(["three"])
    }),
  )

  it.effect("replays a real compacted session.updated without dying on the missing row", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = SessionID.make("ses_compact_4")

      yield* events.publish(SessionV1.Event.Updated, { sessionID: aggregateID, info: sessionInfo(aggregateID, "one") })
      const second = yield* events.publish(SessionV1.Event.Updated, {
        sessionID: aggregateID,
        info: sessionInfo(aggregateID, "two"),
      })

      const stored = yield* Database.Service.pipe(
        Effect.flatMap((service) =>
          service.db.select().from(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).pipe(Effect.orDie),
        ),
      )
      expect(stored).toHaveLength(1)

      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SessionV1.Event.Updated.type, 1),
        seq: second.durable!.seq - 1,
        aggregateID,
        data: { sessionID: aggregateID, info: sessionInfo(aggregateID, "one") },
      })
    }),
  )

  it.effect("replayAll accepts gaps left by compaction", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = SessionID.make("ses_compact_5")

      const source = yield* events.replayAll([
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SessionV1.Event.Updated.type, 1),
          seq: 0,
          aggregateID,
          data: { sessionID: aggregateID, info: sessionInfo(aggregateID, "one") },
        },
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SessionV1.Event.Updated.type, 1),
          seq: 7,
          aggregateID,
          data: { sessionID: aggregateID, info: sessionInfo(aggregateID, "eight") },
        },
      ])

      expect(source).toBe(aggregateID)
      const stored = yield* Database.Service.pipe(
        Effect.flatMap((service) =>
          service.db.select().from(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).pipe(Effect.orDie),
        ),
      )
      // The seq 0 snapshot is compacted away by the newer seq 7 snapshot during replay: convergence.
      expect(stored.map((row) => row.seq)).toEqual([7])
    }),
  )
})
