import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { Database } from "@opencode-ai/core/database/database"
import { Session } from "@opencode-ai/schema/session"
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

const messageUpdated = (
  sid: Session.ID,
  mid: SessionV1.MessageID,
): EventV2.Data<typeof SessionV1.Event.MessageUpdated> =>
  ({
    sessionID: sid,
    info: {
      role: "user",
      sessionID: sid,
      id: mid,
      time: { created: 1 },
      files: [],
      agents: [],
      text: "hello",
      agent: "build",
      model: { providerID: "openrouter", modelID: "test/model" },
    },
  }) as never

describe("EventV2.publish persist gate", () => {
  it.effect("persist:false skips the event log entirely", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sid = Session.ID.create()
      const mid = SessionV1.MessageID.ascending()

      const notified = yield* events.publish(SessionV1.Event.MessageUpdated, messageUpdated(sid, mid), {
        persist: false,
      })

      const eventRows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sid))
        .all()
        .pipe(Effect.orDie)
      const seqRows = yield* db
        .select()
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, sid))
        .all()
        .pipe(Effect.orDie)

      expect(eventRows).toHaveLength(0)
      expect(seqRows).toHaveLength(0)
      // Payload still delivered to the caller (and thus to PubSub/SSE).
      expect(notified.type).toBe("message.updated")
      expect(notified.durable).toBeUndefined()
    }),
  )

  it.effect("persist:true (default) writes the event log and advances the sequence", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sid = Session.ID.create()
      const mid = SessionV1.MessageID.ascending()

      yield* events.publish(SessionV1.Event.MessageUpdated, messageUpdated(sid, mid))

      const eventRows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sid))
        .all()
        .pipe(Effect.orDie)
      const seqRows = yield* db
        .select()
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, sid))
        .all()
        .pipe(Effect.orDie)
      expect(eventRows).toHaveLength(1)
      expect(seqRows).toHaveLength(1)
      expect(seqRows[0]?.seq).toBe(0)
    }),
  )
})