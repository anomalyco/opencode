import { expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { MessageID, PartID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      Snapshot.node,
      Database.node,
      SessionSummary.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [[InstanceBootstrap.node, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })]],
  ),
)

const fixture = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const snapshot = yield* Snapshot.Service
  const tmp = yield* TestInstance
  const chat = yield* sessions.create({ title: "summary fixture" })
  yield* Effect.addFinalizer(() => sessions.remove(chat.id).pipe(Effect.orDie))
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: chat.id,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
  })
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: chat.id,
    role: "assistant",
    parentID: user.id,
    time: { created: 2 },
    agent: "build",
    mode: "build",
    providerID: ProviderV2.ID.make("test"),
    modelID: ModelV2.ID.make("test"),
    path: { cwd: tmp.directory, root: tmp.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const before = yield* snapshot.track()
  expect(before).toBeDefined()
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: chat.id,
    messageID: assistant.id,
    type: "step-start",
    snapshot: before,
  })
  yield* Effect.promise(() => Bun.write(`${tmp.directory}/changed.txt`, "large patch fixture\n".repeat(2000)))
  const finish = () =>
    Effect.gen(function* () {
      const after = yield* snapshot.track()
      expect(after).toBeDefined()
      yield* sessions.updatePart({
        id: PartID.ascending(),
        sessionID: chat.id,
        messageID: assistant.id,
        type: "step-finish",
        snapshot: after,
        reason: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
    })
  const input = { sessionID: chat.id, messageID: user.id }
  const { db } = yield* Database.Service
  const rows = () =>
    db
      .select()
      .from(EventTable)
      .where(and(eq(EventTable.aggregate_id, chat.id), eq(EventTable.type, "message.updated.1")))
      .orderBy(EventTable.seq)
      .all()
      .pipe(Effect.orDie)
  return { input, user, finish, rows, directory: tmp.directory }
})

it.instance(
  "unchanged step-finish diffs publish one message update and remain readable",
  () =>
    Effect.gen(function* () {
      const summary = yield* SessionSummary.Service
      const f = yield* fixture
      const initial = (yield* f.rows()).length
      yield* f.finish()
      yield* summary.summarize(f.input)
      const diffs = yield* summary.diff(f.input)
      expect(diffs).toHaveLength(1)
      expect(diffs[0]!.file).toBe("changed.txt")
      expect(diffs[0]!.patch).toContain("large patch fixture")
      yield* f.finish()
      yield* summary.summarize(f.input)
      const updates = (yield* f.rows()).slice(initial)
      process.stdout.write(
        `SUMMARY_VOLUME ${JSON.stringify({ rows: updates.length, bytes: updates.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.data)), 0) })}\n`,
      )
      expect(updates.length).toBe(1)
      expect(updates[0]!.data.info).not.toHaveProperty("summary")
      expect(Buffer.byteLength(JSON.stringify(updates[0]!.data))).toBeLessThan(1000)
      expect(yield* summary.diff(f.input)).toEqual(diffs)
    }),
  { git: true },
)

it.instance(
  "changed step-finish diffs publish another update and replace the stored patch",
  () =>
    Effect.gen(function* () {
      const summary = yield* SessionSummary.Service
      const f = yield* fixture
      const initial = (yield* f.rows()).length
      yield* f.finish()
      yield* summary.summarize(f.input)
      const before = yield* summary.diff(f.input)
      yield* Effect.promise(() => Bun.write(`${f.directory}/second.txt`, "second file\n"))
      yield* f.finish()
      yield* summary.summarize(f.input)
      const after = yield* summary.diff(f.input)
      expect(after).toHaveLength(2)
      expect(after).not.toEqual(before)
      expect(after.find((diff) => diff.file === "second.txt")?.patch).toContain("+second file")
      expect((yield* f.rows()).length - initial).toBe(2)
    }),
  { git: true },
)

it.instance(
  "summary omission preserves the message projection and explicit empty diffs clear it",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const f = yield* fixture
      const full = {
        ...f.user,
        summary: {
          title: "title",
          body: "body",
          diffs: [{ file: "old.txt", patch: "old patch", additions: 1, deletions: 0 }],
        },
      }
      yield* sessions.updateMessage(full)
      yield* sessions.updateMessage({ ...f.user, agent: "changed" })
      const { db } = yield* Database.Service
      const row = yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get().pipe(Effect.orDie)
      expect(row?.data.summary).toEqual(full.summary)
      expect(row?.data.agent).toBe("changed")
      expect(yield* summary.diff(f.input)).toEqual(full.summary.diffs)
      const empty = { ...full, summary: { ...full.summary, diffs: [] } }
      yield* sessions.updateMessage(empty, { stripSummaryDiffs: true })
      expect(empty.summary.title).toBe("title")
      expect(yield* summary.diff(f.input)).toEqual([])
      const updated = yield* db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.id, f.user.id))
        .get()
        .pipe(Effect.orDie)
      expect(updated?.data.summary).toEqual(empty.summary)
      expect((yield* f.rows()).at(-1)!.data.info).not.toHaveProperty("summary")
    }),
  { git: true },
)

it.instance(
  "failed event insertion rolls back the local summary commit",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const f = yield* fixture
      const full = {
        ...f.user,
        summary: { diffs: [{ file: "old.txt", patch: "old patch", additions: 1, deletions: 0 }] },
      }
      yield* sessions.updateMessage(full)
      const initial = (yield* f.rows()).length
      const { db } = yield* Database.Service
      yield* db
        .run(
          sql`CREATE TEMP TRIGGER reject_summary_event BEFORE INSERT ON event
      WHEN NEW.type = 'message.updated.1' BEGIN SELECT RAISE(ABORT, 'reject summary event'); END`,
        )
        .pipe(Effect.orDie)
      const exit = yield* sessions
        .updateMessage({ ...full, summary: { diffs: [] } }, { stripSummaryDiffs: true })
        .pipe(Effect.exit, Effect.ensuring(db.run(sql`DROP TRIGGER reject_summary_event`).pipe(Effect.orDie)))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* summary.diff(f.input)).toEqual(full.summary.diffs)
      expect((yield* f.rows()).length).toBe(initial)
    }),
  { git: true },
)

it.instance(
  "session summary counters do not clear existing session diffs",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const f = yield* fixture
      const diffs = [{ file: "old.txt", patch: "old patch", additions: 1, deletions: 0 }]
      yield* sessions.setSummary({
        sessionID: f.input.sessionID,
        summary: { additions: 1, deletions: 0, files: 1, diffs },
      })
      yield* sessions.setSummary({ sessionID: f.input.sessionID, summary: { additions: 0, deletions: 0, files: 0 } })
      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, f.input.sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.summary_diffs).toEqual(diffs)
    }),
  { git: true },
)

it.instance(
  "field order changes do not republish summaries or reset session counters",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const f = yield* fixture
      yield* f.finish()
      yield* summary.summarize(f.input)
      const diffs = yield* summary.diff(f.input)
      yield* sessions.updateMessage({
        ...f.user,
        summary: {
          diffs: diffs.map((diff) => ({
            status: diff.status,
            deletions: diff.deletions,
            additions: diff.additions,
            patch: diff.patch,
            file: diff.file,
          })),
        },
      })
      yield* sessions.setSummary({ sessionID: f.input.sessionID, summary: { additions: 7, deletions: 3, files: 2 } })
      const initial = (yield* f.rows()).length
      yield* summary.summarize(f.input)
      expect((yield* f.rows()).length).toBe(initial)
      const chat = yield* sessions.get(f.input.sessionID)
      expect(chat.summary?.additions).toBe(7)
      expect(yield* summary.diff(f.input)).toEqual(diffs)
    }),
  { git: true },
)
