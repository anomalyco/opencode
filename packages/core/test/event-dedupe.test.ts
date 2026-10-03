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
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { asc, eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location({ directory: AbsolutePath.make("project"), workspaceID: WorkspaceV2.ID.make("wrk_test") }),
  ),
)

const Snapshot = EventV2.define({
  type: "test.snapshot",
  durable: {
    aggregate: "sessionID",
    version: 1,
    dedupe: ["$.time", "$.entity.time.start"],
  },
  schema: {
    sessionID: SessionID,
    entity: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      time: Schema.Struct({ start: Schema.Finite }),
    }),
    time: Schema.Finite,
  },
})

const snapshot = (sessionID: SessionID, text: string, start: number, time: number) => ({
  sessionID,
  entity: { id: "entity", text, time: { start } },
  time,
})

const toolPart = (input: {
  sessionID: SessionID
  id: string
  title: string
  start: number
  metadataTime: number
}) =>
  ({
    id: SessionV1.PartID.make(input.id),
    sessionID: input.sessionID,
    messageID: SessionV1.MessageID.make("msg_dedupe"),
    type: "tool",
    callID: "call_dedupe",
    tool: "bash",
    state: {
      status: "running",
      input: {},
      title: input.title,
      metadata: { time: input.metadataTime },
      time: { start: input.start },
    },
  }) satisfies SessionV1.ToolPart

const Tagged = EventV2.define({
  type: "test.tagged",
  durable: {
    aggregate: "sessionID",
    version: 1,
    // Resolves to an array, which compactKey cannot use as a key.
    compact: "$.entity.tags",
    dedupe: ["$.time"],
  },
  schema: {
    sessionID: SessionID,
    entity: Schema.Struct({
      id: Schema.String,
      tags: Schema.Array(Schema.String),
    }),
    time: Schema.Finite,
  },
})

const tagged = (sessionID: SessionID, tags: string[], time: number) => ({
  sessionID,
  entity: { id: "entity", tags },
  time,
})

const Listed = EventV2.define({
  type: "test.listed",
  durable: {
    aggregate: "sessionID",
    version: 1,
    dedupe: ["$.time", "$.entity.tags"],
  },
  schema: {
    sessionID: SessionID,
    entity: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      tags: Schema.Array(Schema.String),
    }),
    time: Schema.Finite,
  },
})

const listed = (sessionID: SessionID, text: string, tags: string[], time: number) => ({
  sessionID,
  entity: { id: "entity", text, tags },
  time,
})

describe("EventV2 snapshot dedupe", () => {
  const it = testEffect(
    AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, Location.node]), [
      [Location.node, locationLayer],
    ]),
  )

  const rows = (aggregateID: string) =>
    Database.Service.pipe(
      Effect.flatMap((service) =>
        service.db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, aggregateID))
          .orderBy(asc(EventTable.seq))
          .pipe(Effect.orDie),
      ),
    )

  it.effect("skips a snapshot identical apart from its ignored paths", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessionID = SessionID.make("ses_dedupe_1")

      const first = yield* events.publish(Snapshot, snapshot(sessionID, "hello", 1, 10))
      const duplicate = yield* events.publish(Snapshot, snapshot(sessionID, "hello", 2, 20))
      const changed = yield* events.publish(Snapshot, snapshot(sessionID, "world", 3, 30))

      expect(first.durable?.seq).toBe(0)
      expect(duplicate.durable).toBeUndefined()
      expect(changed.durable?.seq).toBe(1)

      const stored = yield* rows(sessionID)
      expect(stored.map((row) => row.seq)).toEqual([0, 1])
    }),
  )

  it.effect("notifies live listeners about a skipped snapshot", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessionID = SessionID.make("ses_dedupe_2")
      const received: Array<{ type: string; durable: boolean }> = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          received.push({ type: event.type, durable: event.durable !== undefined })
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* events.publish(Snapshot, snapshot(sessionID, "same", 1, 10))
      yield* events.publish(Snapshot, snapshot(sessionID, "same", 2, 20))

      expect(received).toEqual([
        { type: "test.snapshot", durable: true },
        { type: "test.snapshot", durable: false },
      ])
      expect(yield* rows(sessionID)).toHaveLength(1)
    }),
  )

  it.effect("keeps the same snapshot on a different aggregate", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const one = SessionID.make("ses_dedupe_3a")
      const two = SessionID.make("ses_dedupe_3b")

      const first = yield* events.publish(Snapshot, snapshot(one, "same", 1, 10))
      const second = yield* events.publish(Snapshot, snapshot(two, "same", 1, 10))

      expect(first.durable?.seq).toBe(0)
      expect(second.durable?.seq).toBe(0)
      expect(yield* rows(one)).toHaveLength(1)
      expect(yield* rows(two)).toHaveLength(1)
    }),
  )

  it.effect("skips duplicate message.part.updated snapshots", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessionID = SessionID.make("ses_dedupe_4")
      const id = "prt_dedupe_4"

      yield* events.publish(SessionV1.Event.PartUpdated, {
        sessionID,
        part: toolPart({ sessionID, id, title: "ls", start: 1, metadataTime: 5 }),
        time: 10,
      })
      const duplicate = yield* events.publish(SessionV1.Event.PartUpdated, {
        sessionID,
        part: toolPart({ sessionID, id, title: "ls", start: 2, metadataTime: 6 }),
        time: 20,
      })
      const changed = yield* events.publish(SessionV1.Event.PartUpdated, {
        sessionID,
        part: toolPart({ sessionID, id, title: "ls -la", start: 3, metadataTime: 7 }),
        time: 30,
      })

      expect(duplicate.durable).toBeUndefined()
      expect(changed.durable?.seq).toBe(1)

      // The durable aggregate is the session and compaction keeps only the
      // latest snapshot of the part, so a real change lands at sequence 1.
      const stored = yield* rows(sessionID)
      expect(stored.map((row) => row.seq)).toEqual([1])
    }),
  )

  it.effect("persists dedupe-enabled snapshots during replay", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessionID = SessionID.make("ses_dedupe_5")
      const id = "prt_dedupe_5"
      const part = toolPart({ sessionID, id, title: "ls", start: 1, metadataTime: 1 })

      yield* events.publish(SessionV1.Event.PartUpdated, { sessionID, part, time: 10 })
      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SessionV1.Event.PartUpdated.type, 1),
        seq: 1,
        aggregateID: sessionID,
        data: {
          sessionID,
          part: { ...part, state: { ...part.state, time: { start: 2 } } },
          time: 20,
        },
      })

      // Replay must always write; if it were deduped the row would stay at 0.
      const stored = yield* rows(sessionID)
      expect(stored.map((row) => row.seq)).toEqual([1])
    }),
  )

  it.effect("commit-hook writes bypass dedupe", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessionID = SessionID.make("ses_dedupe_6")

      yield* events.publish(Snapshot, snapshot(sessionID, "same", 1, 10))
      // The commit hook path must always persist, even when identical apart
      // from ignored paths, because the hook's projection must stay atomic
      // with a stored row.
      const duplicate = yield* events.publish(
        Snapshot,
        snapshot(sessionID, "same", 2, 20),
        { commit: () => Effect.void },
      )

      expect(duplicate.durable?.seq).toBe(1)
      expect(yield* rows(sessionID)).toHaveLength(2)
    }),
  )

  it.effect("unresolvable compact path disables dedupe and compaction", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessionID = SessionID.make("ses_dedupe_7")

      const first = yield* events.publish(Tagged, tagged(sessionID, ["a"], 10))
      const second = yield* events.publish(Tagged, tagged(sessionID, ["a"], 20))

      // The compact path resolves to an array, so no entity key exists: every
      // snapshot persists and nothing is compacted away.
      expect(first.durable?.seq).toBe(0)
      expect(second.durable?.seq).toBe(1)
      expect(yield* rows(sessionID)).toHaveLength(2)
    }),
  )

  it.effect("dedupe ignores arrays as whole values", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessionID = SessionID.make("ses_dedupe_8")

      yield* events.publish(Listed, listed(sessionID, "same", ["a", "b"], 10))
      const same = yield* events.publish(Listed, listed(sessionID, "same", ["a", "b"], 20))
      const reordered = yield* events.publish(Listed, listed(sessionID, "same", ["b", "a"], 30))
      const changed = yield* events.publish(Listed, listed(sessionID, "changed", ["a", "b"], 40))

      expect(same.durable).toBeUndefined()
      expect(reordered.durable).toBeUndefined()
      expect(changed.durable?.seq).toBe(1)
      expect(yield* rows(sessionID)).toHaveLength(2)
    }),
  )
})
