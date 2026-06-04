import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { eq, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { DataMigrationTable } from "@opencode-ai/core/data-migration.sql"
import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { DeepMutable } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { MessageTable, PartTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"

const tmp = new Array<string>()
const sessionID = SessionSchema.ID.make("ses_v2_message_backfill")
const providerID = ProviderV2.ID.make("provider")
const modelID = ProviderV2.ModelID.make("model")
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

afterEach(async () => {
  await Promise.all(tmp.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeDbPath() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-session-v2-backfill-"))
  tmp.push(dir)
  return join(dir, "backfill.db")
}

function layer(filename: string) {
  const database = Database.layerFromPath(filename)
  return Layer.merge(database, SessionV2.layer.pipe(Layer.provide(database)))
}

function run<A, E>(filename: string, effect: Effect.Effect<A, E, Database.Service | SessionV2.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer(filename)), Effect.scoped))
}

function user(id: string, created: number, value: string): SessionLegacy.WithParts {
  return {
    info: {
      id: SessionLegacy.MessageID.make(id),
      sessionID,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID, modelID },
    },
    parts: [text(id, `${id.replace("msg", "prt")}_text`, value)],
  }
}

function compactionMarker(id: string, created: number): SessionLegacy.WithParts {
  return {
    info: {
      id: SessionLegacy.MessageID.make(id),
      sessionID,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID, modelID },
    },
    parts: [
      {
        id: SessionLegacy.PartID.make(`${id.replace("msg", "prt")}_compact`),
        sessionID,
        messageID: SessionLegacy.MessageID.make(id),
        type: "compaction",
        auto: true,
      },
    ],
  }
}

function summaryAssistant(id: string, created: number, parentID: string, value: string): SessionLegacy.WithParts {
  return {
    info: {
      id: SessionLegacy.MessageID.make(id),
      sessionID,
      role: "assistant",
      parentID: SessionLegacy.MessageID.make(parentID),
      time: { created, completed: created + 1 },
      providerID,
      modelID,
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp/backfill", root: "/tmp/backfill" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      summary: true,
      finish: "stop",
    },
    parts: [text(id, `${id.replace("msg", "prt")}_text`, value)],
  }
}

function text(messageID: string, id: string, value: string): SessionLegacy.TextPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "text",
    text: value,
  }
}

function liveUser(id: string, created: number, value: string) {
  return new SessionMessage.User({
    id: SessionMessage.ID.make(id),
    type: "user",
    text: value,
    files: [],
    agents: [],
    references: [],
    time: { created: DateTime.makeUnsafe(created) },
  })
}

function seedSession() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.run(sql`
      INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes)
      VALUES ('proj_session_v2_backfill', '/tmp/backfill', 'backfill', 1, 1, '[]')
    `)
    yield* db.run(sql`
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES (${sessionID}, 'proj_session_v2_backfill', 'backfill', '/tmp/backfill', 'backfill', 'test', 1, 1)
    `)
  })
}

function seedLegacy(entries: SessionLegacy.WithParts[]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(MessageTable).values(entries.map((entry) => messageRow(entry.info))).run()
    const parts = entries.flatMap((entry) => entry.parts.map(partRow))
    if (parts.length > 0) yield* db.insert(PartTable).values(parts).run()
  })
}

function seedV2(messages: SessionMessage.Message[]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(SessionMessageTable).values(messages.map(v2Row)).run()
  })
}

function markerExists() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    return !!(yield* db.select().from(DataMigrationTable).where(eq(DataMigrationTable.name, markerName())).get())
  })
}

function messageRow(info: SessionLegacy.Info): typeof MessageTable.$inferInsert {
  const { id, sessionID: rowSessionID, ...data } = info
  return { id, session_id: rowSessionID, time_created: info.time.created, data: data as DeepMutable<typeof data> }
}

function partRow(part: SessionLegacy.Part): typeof PartTable.$inferInsert {
  const { id, sessionID: rowSessionID, messageID, ...data } = part
  return { id, session_id: rowSessionID, message_id: messageID, time_created: 1, data: data as DeepMutable<typeof data> }
}

function v2Row(message: SessionMessage.Message): typeof SessionMessageTable.$inferInsert {
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return { id: SessionMessage.ID.make(id), session_id: sessionID, type, time_created: DateTime.toEpochMillis(message.time.created), data }
}

function markerName() {
  return `legacy-session-message-backfill/v1/${sessionID}`
}

function failBackfillMarkerInsert() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.run(sql`
      CREATE TEMP TRIGGER fail_backfill_marker
      BEFORE INSERT ON data_migration
      WHEN NEW.name = ${sql.raw(sqlString(markerName()))}
      BEGIN
        SELECT RAISE(ABORT, 'backfill marker failed');
      END
    `)
  })
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

describe("SessionV2 legacy message backfill read hook", () => {
  test("messages triggers backfill and returns legacy rows decoded as v2", async () => {
    const dbPath = await makeDbPath()

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([user("msg_first", 10, "first"), user("msg_second", 20, "second")])

        const session = yield* SessionV2.Service
        const messages = yield* session.messages({ sessionID, order: "asc" })

        expect(messages.map((message) => message.type)).toEqual(["user", "user"])
        expect(messages.map((message) => (message.type === "user" ? message.text : ""))).toEqual(["first", "second"])
        expect(yield* markerExists()).toBe(true)
      }),
    )
  })

  test("messages preserves asc, desc, limit, and cursor behavior after backfill", async () => {
    const dbPath = await makeDbPath()

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([user("msg_a", 10, "a"), user("msg_b", 20, "b"), user("msg_c", 30, "c")])

        const session = yield* SessionV2.Service
        const asc = yield* session.messages({ sessionID, order: "asc", limit: 2 })
        const desc = yield* session.messages({ sessionID, limit: 2 })
        const afterFirst = yield* session.messages({
          sessionID,
          order: "asc",
          limit: 1,
          cursor: { id: asc[0]!.id, time: DateTime.toEpochMillis(asc[0]!.time.created), direction: "next" },
        })

        expect(asc.map((message) => (message.type === "user" ? message.text : ""))).toEqual(["a", "b"])
        expect(desc.map((message) => (message.type === "user" ? message.text : ""))).toEqual(["c", "b"])
        expect(afterFirst.map((message) => (message.type === "user" ? message.text : ""))).toEqual(["b"])
      }),
    )
  })

  test("context triggers backfill and returns newest compaction anchor plus later rows", async () => {
    const dbPath = await makeDbPath()

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([
          user("msg_before", 10, "before"),
          compactionMarker("msg_compact", 20),
          summaryAssistant("msg_summary", 21, "msg_compact", "summary"),
          user("msg_after", 30, "after"),
        ])

        const session = yield* SessionV2.Service
        const messages = yield* session.context(sessionID)

        expect(messages.map((message) => message.type)).toEqual(["compaction", "user"])
        expect(messages[0]).toMatchObject({ type: "compaction", summary: "summary" })
        expect(messages[1]).toMatchObject({ type: "user", text: "after" })
        expect(yield* markerExists()).toBe(true)
      }),
    )
  })

  test("mixed equal cutoff abort returns current live v2 rows without marker", async () => {
    const dbPath = await makeDbPath()

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([user("msg_equal", 50, "legacy equal")])
        yield* seedV2([liveUser("evt_live_equal", 50, "live equal")])

        const session = yield* SessionV2.Service
        const messages = yield* session.messages({ sessionID })

        expect(messages.map((message) => (message.type === "user" ? message.text : ""))).toEqual(["live equal"])
        expect(yield* markerExists()).toBe(false)
      }),
    )
  })

  test("marker insert failure fallback returns current v2 rows without marker", async () => {
    const dbPath = await makeDbPath()

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([user("msg_legacy", 10, "legacy")])
        yield* seedV2([liveUser("evt_live", 20, "live")])
        yield* failBackfillMarkerInsert()

        const session = yield* SessionV2.Service
        const messages = yield* session.messages({ sessionID })

        expect(messages.map((message) => (message.type === "user" ? message.text : ""))).toEqual(["live"])
        expect(yield* markerExists()).toBe(false)
      }),
    )
  })
})
