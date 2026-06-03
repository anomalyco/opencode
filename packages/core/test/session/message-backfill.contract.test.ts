import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { asc, eq, sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { DataMigrationTable } from "@opencode-ai/core/data-migration.sql"
import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { DeepMutable } from "@opencode-ai/core/schema"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageBackfill } from "@opencode-ai/core/session/message-backfill"
import { SessionMessageBackfillService } from "@opencode-ai/core/session/message-backfill-service"
import { MessageTable, PartTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"

const tmp = new Array<string>()
const sessionID = SessionSchema.ID.make("ses_message_backfill_contract")
const providerID = ProviderV2.ID.make("provider")
const modelID = ProviderV2.ModelID.make("model")
const markerName = `legacy-session-message-backfill/v1/${sessionID}`
const encodeMessage = Schema.encodeSync(SessionMessage.Message)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)

afterEach(async () => {
  await Promise.all(tmp.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeDbPath() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-message-backfill-contract-"))
  tmp.push(dir)
  return join(dir, "backfill.db")
}

function layer(filename: string) {
  return Database.layerFromPath(filename)
}

function run<A, E>(filename: string, effect: Effect.Effect<A, E, Database.Service>) {
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
      VALUES ('proj_message_backfill', '/tmp/backfill', 'backfill', 1, 1, '[]')
    `)
    yield* db.run(sql`
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES (${sessionID}, 'proj_message_backfill', 'backfill', '/tmp/backfill', 'backfill', 'test', 1, 1)
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

function seedV2(message: SessionMessage.Message) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(SessionMessageTable).values([v2Row(message)]).run()
  })
}

function seedMarker() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(DataMigrationTable).values({ name: markerName, time_completed: 1 }).run()
  })
}

function readV2Rows() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
      .all()
  })
}

function markerExists() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    return !!(yield* db.select().from(DataMigrationTable).where(eq(DataMigrationTable.name, markerName)).get())
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

function expectedRows(entries: SessionLegacy.WithParts[]) {
  return SessionMessageBackfill.mapLegacyMessages(entries, { sessionID }).messages.map(v2Row)
}

function assertNoLegacyIDs(value: unknown) {
  const encoded = JSON.stringify(value)
  expect(encoded).not.toContain("msg_")
  expect(encoded).not.toContain("prt_")
}

function statCount(stats: SessionMessageBackfill.Stat[], reason: string) {
  return stats.find((stat) => stat.reason === reason)?.count ?? 0
}

describe("SessionMessageBackfillService contract", () => {
  test("no marker: legacy rows become v2 rows and marker is written", async () => {
    const dbPath = await makeDbPath()
    const entries = [user("msg_first", 10, "first visible"), user("msg_second", 20, "second visible")]

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy(entries)

        const result = yield* SessionMessageBackfillService.ensureLegacySessionMessagesBackfilled(sessionID)
        const rows = yield* readV2Rows()

        expect(result.status).toBe("completed")
        if (result.status !== "completed") throw new Error("expected completed")
        expect(result.inserted).toBe(2)
        expect(result.repaired).toBe(0)
        expect(yield* markerExists()).toBe(true)
        expect(rows.map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }).type)).toEqual(["user", "user"])
        expect(rows.map((row) => row.id)).toEqual(expectedRows(entries).map((row) => row.id))
        assertNoLegacyIDs(rows)
      }),
    )
  })

  test("marker write failure rolls back inserted rows and marker", async () => {
    const dbPath = await makeDbPath()
    const entries = [user("msg_rollback_a", 10, "rollback a"), user("msg_rollback_b", 20, "rollback b")]

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy(entries)
        yield* failBackfillMarkerInsert()

        const exit = yield* SessionMessageBackfillService.ensureLegacySessionMessagesBackfilled(sessionID).pipe(Effect.exit)

        expect(exit._tag).toBe("Failure")
        expect(yield* readV2Rows()).toEqual([])
        expect(yield* markerExists()).toBe(false)
      }),
    )
  })

  test("marker exists: returns already_completed and does not trip marker insert trigger", async () => {
    const dbPath = await makeDbPath()

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([user("msg_marked", 10, "already marked")])
        yield* seedMarker()
        yield* failBackfillMarkerInsert()

        const result = yield* SessionMessageBackfillService.ensureLegacySessionMessagesBackfilled(sessionID)

        expect(result.status).toBe("already_completed")
        expect(yield* readV2Rows()).toEqual([])
      }),
    )
  })

  test("mixed equal cutoff aborts without rows or marker", async () => {
    const dbPath = await makeDbPath()

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([user("msg_equal", 50, "equal boundary")])
        yield* seedV2(liveUser("evt_live_equal", 50, "live"))

        const result = yield* SessionMessageBackfillService.ensureLegacySessionMessagesBackfilled(sessionID)
        const rows = yield* readV2Rows()

        expect(result.status).toBe("aborted")
        if (result.status !== "aborted") throw new Error("expected aborted")
        expect(result.reason).toBe("mixed_cutoff_ambiguous")
        expect(statCount(result.stats.skipped, "mixed_cutoff_ambiguous")).toBe(1)
        expect(yield* markerExists()).toBe(false)
        expect(rows.map((row) => row.id)).toEqual([SessionMessage.ID.make("evt_live_equal")])
      }),
    )
  })

  test("cutoff backfills only older legacy rows and writes marker", async () => {
    const dbPath = await makeDbPath()
    const older = user("msg_older", 10, "older")

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([older, user("msg_newer", 70, "newer")])
        yield* seedV2(liveUser("evt_live_newer", 50, "live"))

        const result = yield* SessionMessageBackfillService.ensureLegacySessionMessagesBackfilled(sessionID)
        const rows = yield* readV2Rows()

        expect(result.status).toBe("completed")
        if (result.status !== "completed") throw new Error("expected completed")
        expect(result.inserted).toBe(1)
        expect(statCount(result.stats.skipped, "legacy_newer_than_cutoff_omitted")).toBe(1)
        expect(yield* markerExists()).toBe(true)
        expect(rows.map((row) => row.id)).toEqual([expectedRows([older])[0]?.id, SessionMessage.ID.make("evt_live_newer")])
      }),
    )
  })

  test("partial retry without marker repairs exact existing migration rows", async () => {
    const dbPath = await makeDbPath()
    const entries = [user("msg_partial_a", 10, "partial a"), user("msg_partial_b", 20, "partial b")]

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy(entries)
        yield* dbInsertSessionMessage(expectedRows(entries)[0]!)

        const result = yield* SessionMessageBackfillService.ensureLegacySessionMessagesBackfilled(sessionID)
        const rows = yield* readV2Rows()

        expect(result.status).toBe("completed")
        if (result.status !== "completed") throw new Error("expected completed")
        expect(result.inserted).toBe(1)
        expect(result.repaired).toBe(1)
        expect(yield* markerExists()).toBe(true)
        expect(rows.map((row) => row.id)).toEqual(expectedRows(entries).map((row) => row.id))
      }),
    )
  })

  test("deterministic ID collision aborts and leaves existing row unchanged", async () => {
    const dbPath = await makeDbPath()
    const entry = user("msg_collision", 10, "expected")

    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* seedLegacy([entry])
        const expected = expectedRows([entry])[0]!
        const conflicting = { ...expected, data: { ...expected.data, text: "different" } }
        yield* dbInsertSessionMessage(conflicting)

        const result = yield* SessionMessageBackfillService.ensureLegacySessionMessagesBackfilled(sessionID)
        const rows = yield* readV2Rows()

        expect(result.status).toBe("aborted")
        if (result.status !== "aborted") throw new Error("expected aborted")
        expect(result.reason).toBe("deterministic_id_collision")
        expect(statCount(result.stats.skipped, "deterministic_id_collision")).toBe(1)
        expect(yield* markerExists()).toBe(false)
        expect(rows).toHaveLength(1)
        expect(rows[0]?.id).toBe(conflicting.id)
        expect(rows[0]?.data).toEqual(conflicting.data)
      }),
    )
  })
})

function dbInsertSessionMessage(row: typeof SessionMessageTable.$inferInsert) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(SessionMessageTable).values([row]).run()
  })
}

function failBackfillMarkerInsert() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.run(sql`
      CREATE TEMP TRIGGER fail_backfill_marker
      BEFORE INSERT ON data_migration
      WHEN NEW.name = ${sql.raw(sqlString(markerName))}
      BEGIN
        SELECT RAISE(ABORT, 'backfill marker failed');
      END
    `)
  })
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}
