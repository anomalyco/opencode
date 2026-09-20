import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV1 } from "@opencode-ai/schema/v1/session"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
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
import { TestInstance, provideInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const nodes = LayerNode.group([
  Session.node,
  EventV2.node,
  Snapshot.node,
  Database.node,
  SessionSummary.node,
  SessionProjector.node,
  CrossSpawnSpawner.node,
  InstanceStore.node,
])
const bootstrap = Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })
const it = testEffect(AppNodeBuilder.build(nodes, [[InstanceBootstrap.node, bootstrap]]))

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
  return { input, user, assistant, finish, rows, directory: tmp.directory }
})

const replayFixture = Effect.gen(function* () {
  const summary = yield* SessionSummary.Service
  const snapshot = yield* Snapshot.Service
  const { db } = yield* Database.Service
  const f = yield* fixture
  yield* f.finish()
  yield* summary.summarize(f.input)
  const expected = yield* summary.diff(f.input)
  expect(expected[0]!.patch).toContain("+large patch fixture")
  const rows = yield* db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, f.input.sessionID))
    .orderBy(EventTable.seq)
    .all()
    .pipe(Effect.orDie)
  const parts = yield* db
    .select()
    .from(PartTable)
    .where(eq(PartTable.session_id, f.input.sessionID))
    .orderBy(PartTable.id)
    .all()
    .pipe(Effect.orDie)
  expect(parts.map((part) => part.data.type)).toEqual(["step-start", "step-finish"])
  const replay = Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    // B is a separate, empty database. Instance setup creates only project
    // metadata; all session/message/part rows below come from durable events.
    expect(yield* db.select().from(SessionTable).all()).toEqual([])
    expect(yield* db.select().from(MessageTable).all()).toEqual([])
    expect(yield* db.select().from(PartTable).all()).toEqual([])
    expect(yield* db.select().from(EventTable).all()).toEqual([])
    for (const row of rows) {
      yield* events.replay({
        id: row.id,
        type: row.type,
        seq: row.seq,
        aggregateID: row.aggregate_id,
        data: row.data,
      })
    }
    const rebuilt = yield* db.select().from(PartTable).orderBy(PartTable.id).all()
    expect(rebuilt.map((part) => ({ id: part.id, data: part.data }))).toEqual(
      parts.map((part) => ({ id: part.id, data: part.data })),
    )
    const projected = yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()
    expect(projected?.data.summary?.diffs).toEqual(expected.map(({ patch, ...metadata }) => metadata))
  })
  return {
    ...f,
    expected,
    replay,
    layer: AppNodeBuilder.build(nodes, [
      [InstanceBootstrap.node, bootstrap],
      [Database.node, Database.layerFromPath(":memory:")],
      [Snapshot.node, Layer.succeed(Snapshot.Service, snapshot)],
    ]),
  }
})

it.instance(
  "durable-only replay rebuilds parts and recovers complete patches into database B",
  () =>
    Effect.gen(function* () {
      const f = yield* replayFixture
      yield* Effect.gen(function* () {
        yield* f.replay
        const summary = yield* SessionSummary.Service
        const events = yield* EventV2.Service
        const { db } = yield* Database.Service
        const before = yield* db.select().from(EventTable).orderBy(EventTable.seq).all()
        const received: unknown[] = []
        const unsubscribe = yield* events.listen((event) => Effect.sync(() => { received.push(event) }))
        yield* Effect.addFinalizer(() => unsubscribe)
        expect(yield* summary.diff(f.input)).toEqual(f.expected)
        const projected = yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()
        expect(projected?.data.summary?.diffs).toEqual(f.expected)
        expect(yield* db.select().from(EventTable).orderBy(EventTable.seq).all()).toEqual(before)
        expect(received).toEqual([])
      }).pipe(provideInstance(f.directory), Effect.provide(f.layer))
    }),
  { git: true },
)

it.instance(
  "recovered projection is idempotent and the second diff read does not recompute",
  () =>
    Effect.gen(function* () {
      const f = yield* replayFixture
      yield* Effect.gen(function* () {
        yield* f.replay
        const summary = yield* SessionSummary.Service
        const snapshot = yield* Snapshot.Service
        const { db } = yield* Database.Service
        const real = snapshot.diffFull
        let calls = 0
        Object.assign(snapshot, {
          diffFull: (...args: Parameters<typeof real>) => Effect.suspend(() => { calls++; return real(...args) }),
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(snapshot, { diffFull: real })))
        expect(yield* summary.diff(f.input)).toEqual(f.expected)
        expect(calls).toBe(1)
        const projected = yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()
        expect(yield* summary.diff(f.input)).toEqual(f.expected)
        expect(calls).toBe(1)
        expect(yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()).toEqual(projected)
      }).pipe(provideInstance(f.directory), Effect.provide(f.layer))
    }),
  { git: true },
)

it.instance(
  "failed patch recovery returns runtime truncation without backfill and can retry",
  () =>
    Effect.gen(function* () {
      const f = yield* replayFixture
      yield* Effect.gen(function* () {
        yield* f.replay
        const summary = yield* SessionSummary.Service
        const snapshot = yield* Snapshot.Service
        const { db } = yield* Database.Service
        const before = yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()
        const events = yield* db.select().from(EventTable).orderBy(EventTable.seq).all()
        const real = snapshot.diffFull
        Object.assign(snapshot, { diffFull: () => Effect.die(new Error("snapshot unavailable")) })
        yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(snapshot, { diffFull: real })))
        expect(yield* summary.diff(f.input)).toEqual(
          f.expected.map((item) => ({ ...item, patch: "", truncated: true })),
        )
        expect(yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()).toEqual(before)
        expect(yield* db.select().from(EventTable).orderBy(EventTable.seq).all()).toEqual(events)
        Object.assign(snapshot, { diffFull: real })
        expect(yield* summary.diff(f.input)).toEqual(f.expected)
      }).pipe(provideInstance(f.directory), Effect.provide(f.layer))
    }),
  { git: true },
)

it.instance(
  "unmatched files and missing snapshots return runtime truncation without backfill",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const { db } = yield* Database.Service
      const f = yield* fixture
      const diffs = [{ file: "missing.txt", additions: 1, deletions: 0 }]
      yield* sessions.updateMessage({ ...f.user, summary: { title: "keep", body: "body", diffs } })
      const before = yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()
      // No finish snapshot yet, then a real snapshot diff that has no matching file.
      for (const finish of [false, true]) {
        if (finish) yield* f.finish()
        expect(yield* summary.diff(f.input)).toEqual([{ ...diffs[0], patch: "", truncated: true }])
        expect(yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get()).toEqual(before)
      }
    }),
  { git: true },
)

it.instance(
  "complete local projections including empty patches never recompute",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const snapshot = yield* Snapshot.Service
      const f = yield* fixture
      const real = snapshot.diffFull
      let calls = 0
      Object.assign(snapshot, {
        diffFull: () => Effect.sync(() => { calls++; return [] }),
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(snapshot, { diffFull: real })))
      for (const patch of ["full local patch", ""]) {
        const diffs = [{ file: "local.txt", patch, additions: 1, deletions: 0 }]
        yield* sessions.updateMessage({ ...f.user, summary: { diffs } })
        expect(yield* summary.diff(f.input)).toEqual(diffs)
      }
      expect(calls).toBe(0)
    }),
  { git: true },
)

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
      expect(updates[0]!.data.info.summary.diffs).toEqual([
        { file: "changed.txt", status: "added", additions: 2000, deletions: 0 },
      ])
      // Replaces the old 236-byte summary-free payload with replayable metadata.
      expect(Buffer.byteLength(JSON.stringify(updates[0]!.data))).toBeLessThanOrEqual(400)
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
  "full user updates retain summary and agent changes, and explicit empty diffs clear the projection",
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
      // Real callers always carry full info (prompt.ts, compaction.ts, summary.ts).
      // User upserts without summary only insert new messages (compaction.ts:471/519),
      // so they do not enter the conflict-update branch.
      yield* sessions.updateMessage({ ...full, agent: "changed" })
      const { db } = yield* Database.Service
      const row = yield* db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get().pipe(Effect.orDie)
      expect(row?.data.summary).toEqual(full.summary)
      expect(row?.data.agent).toBe("changed")
      expect(yield* summary.diff(f.input)).toEqual(full.summary.diffs)
      const empty = { ...full, summary: { ...full.summary, diffs: [] } }
      yield* sessions.updateMessage(empty)
      expect(empty.summary.title).toBe("title")
      expect(yield* summary.diff(f.input)).toEqual([])
      const updated = yield* db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.id, f.user.id))
        .get()
        .pipe(Effect.orDie)
      expect(updated?.data.summary).toEqual(empty.summary)
      expect((yield* f.rows()).at(-1)!.data.info.summary).toEqual(empty.summary)
    }),
  { git: true },
)

it.instance(
  "live message updates retain new, replacement, and empty diffs while durable rows omit patches",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* EventV2.Service
      const summary = yield* SessionSummary.Service
      const f = yield* fixture
      const received: EventV2.Data<typeof SessionV1.Event.MessageUpdated>["info"][] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type !== SessionV1.Event.MessageUpdated.type) return
          const data = event.data as EventV2.Data<typeof SessionV1.Event.MessageUpdated>
          if (data.info.id === f.user.id) received.push(structuredClone(data.info))
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const summaries = [
        { title: "first", diffs: [{ file: "new.txt", patch: "new patch\n".repeat(2000), additions: 1, deletions: 0 }] },
        { title: "replacement", diffs: [{ file: "next.txt", patch: "next patch", additions: 2, deletions: 0 }] },
        { title: "empty", diffs: [] },
      ]
      for (const value of summaries) {
        const msg = { ...f.user, summary: value }
        yield* sessions.updateMessage(msg)
        expect(received.at(-1)).toEqual(msg)
        expect(msg.summary).toEqual(value)
        expect(yield* summary.diff(f.input)).toEqual(value.diffs)
        const row = (yield* f.rows()).at(-1)!
        expect(row.data.info.summary).toEqual({
          ...value,
          diffs: value.diffs.map(({ patch, ...metadata }) => metadata),
        })
        expect(Buffer.byteLength(JSON.stringify(row.data))).toBeLessThan(1000)
      }
      expect(received).toHaveLength(3)
    }),
  { git: true },
)

it.instance(
  "failed event insertion rolls back the full message projection",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const f = yield* fixture
      const full = {
        ...f.user,
        summary: { diffs: [{ file: "old.txt", patch: "old patch", additions: 1, deletions: 0 }] },
      }
      // Positive control: prove this same projector writes a new summary before testing rollback.
      yield* sessions.updateMessage(full)
      expect(yield* summary.diff(f.input)).toEqual(full.summary.diffs)
      const { db } = yield* Database.Service
      const message = () =>
        db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get().pipe(Effect.orDie)
      const sequence = () =>
        db
          .select()
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, f.input.sessionID))
          .get()
          .pipe(Effect.orDie)
      const initial = yield* f.rows()
      const previous = yield* message()
      const { id, sessionID, ...data } = full
      expect(previous?.data).toEqual(data)
      const seq = yield* sequence()
      yield* db
        .run(
          sql`CREATE TEMP TRIGGER reject_summary_event BEFORE INSERT ON event
      WHEN NEW.type = 'message.updated.1' BEGIN SELECT RAISE(ABORT, 'reject summary event'); END`,
        )
        .pipe(Effect.orDie)
      const exit = yield* sessions
        .updateMessage({ ...full, summary: { diffs: [] } })
        .pipe(Effect.exit, Effect.ensuring(db.run(sql`DROP TRIGGER reject_summary_event`).pipe(Effect.orDie)))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* summary.diff(f.input)).toEqual(full.summary.diffs)
      expect(yield* message()).toEqual(previous)
      expect(yield* f.rows()).toEqual(initial)
      expect(yield* sequence()).toEqual(seq)
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

it.instance(
  "durable transform strips only user patches and preserves complete assistant and session updates",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const f = yield* fixture
      // Read every event type: a message-only helper cannot test transform scope.
      const rows = () => db.select().from(EventTable).orderBy(EventTable.seq).all().pipe(Effect.orDie)
      const received: unknown[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          received.push(structuredClone(event.data))
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const full = {
        ...f.user,
        summary: { title: "t", body: "b", diffs: [{ file: "x.txt", patch: "+x", additions: 1, deletions: 0 }] },
      }
      yield* sessions.updateMessage(full)
      const user = (yield* rows()).filter((row) => row.aggregate_id === f.input.sessionID).at(-1)!
      expect(user.type).toBe("message.updated.1")
      expect(user.data).toEqual({
        sessionID: f.input.sessionID,
        info: {
          ...f.user,
          summary: { title: "t", body: "b", diffs: [{ file: "x.txt", additions: 1, deletions: 0 }] },
        },
      })
      for (const output of [11, 23]) {
        const next = { ...f.assistant, summary: true, tokens: { ...f.assistant.tokens, output } }
        yield* sessions.updateMessage(next)
        expect(received.at(-1)).toEqual({ sessionID: f.input.sessionID, info: next })
        const row = (yield* rows()).filter((row) => row.aggregate_id === f.input.sessionID).at(-1)!
        expect(row.type).toBe("message.updated.1")
        expect(row.data).toEqual({ sessionID: f.input.sessionID, info: next })
        const projected = yield* db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, next.id))
          .get()
          .pipe(Effect.orDie)
        const { id, sessionID, ...data } = next
        expect(projected?.data).toEqual(data)
      }
      const counters = { additions: 17, deletions: 8, files: 2 }
      yield* sessions.setSummary({ sessionID: f.input.sessionID, summary: counters })
      const updated = (yield* rows()).filter((row) => row.aggregate_id === f.input.sessionID).at(-1)!
      expect(updated.type).toBe("session.updated.1")
      const info = yield* sessions.get(f.input.sessionID)
      expect(info.summary).toEqual(counters)
      expect(updated.data).toEqual({ sessionID: f.input.sessionID, info })
      expect(received.at(-1)).toEqual(updated.data)
    }),
  { git: true },
)

it.instance(
  "incoming replay projects first, replacement, and empty summaries while durable rows stay small",
  () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const summary = yield* SessionSummary.Service
      const { db } = yield* Database.Service
      const f = yield* fixture
      const received: unknown[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionV1.Event.MessageUpdated.type) received.push(structuredClone(event.data))
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const summaries = [
        {
          title: "incoming first",
          diffs: [{ file: "first.txt", patch: "+first\n".repeat(2000), additions: 1, deletions: 0 }],
        },
        { title: "incoming replacement", diffs: [{ file: "next.txt", patch: "+next", additions: 2, deletions: 0 }] },
        { title: "incoming empty", diffs: [] },
      ]
      const sizes: number[] = []
      for (const value of summaries) {
        const sequence = yield* db
          .select()
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, f.input.sessionID))
          .get()
          .pipe(Effect.orDie)
        expect(sequence).toBeDefined()
        const data = { sessionID: f.input.sessionID, info: { ...f.user, summary: value } }
        yield* events.replay(
          {
            id: EventV2.ID.create(),
            type: "message.updated.1",
            seq: sequence!.seq + 1,
            aggregateID: f.input.sessionID,
            data,
          },
          { publish: true },
        )
        expect(received.at(-1)).toEqual(data)
        const projected = yield* db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, f.user.id))
          .get()
          .pipe(Effect.orDie)
        const { id, sessionID, ...info } = data.info
        expect(projected?.data).toEqual(info)
        expect(yield* summary.diff(f.input)).toEqual(value.diffs)
        const stored = (yield* f.rows()).at(-1)!
        expect(stored.data).toEqual({
          sessionID: f.input.sessionID,
          info: { ...f.user, summary: { ...value, diffs: value.diffs.map(({ patch, ...metadata }) => metadata) } },
        })
        const bytes = Buffer.byteLength(JSON.stringify(stored.data))
        sizes.push(bytes)
        expect(bytes).toBeLessThan(1000)
      }
      expect(received).toHaveLength(3)
      process.stdout.write(`INCOMING_DURABLE_BYTES ${JSON.stringify(sizes)}\n`)
    }),
  { git: true },
)

const legacyReplayFixture = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const { db } = yield* Database.Service
  const f = yield* fixture
  const full = {
    ...f.user,
    summary: { title: "legacy", diffs: [{ file: "old.txt", patch: "+old", additions: 1, deletions: 0 }] },
  }
  yield* sessions.updateMessage(full)
  const row = (yield* f.rows()).at(-1)!
  const data = { sessionID: f.input.sessionID, info: full }
  // Reproduce and read back a pre-transform row, rather than merely claiming legacy input.
  yield* db.update(EventTable).set({ data }).where(eq(EventTable.id, row.id)).run().pipe(Effect.orDie)
  const stored = (yield* f.rows()).at(-1)!
  expect(stored.data).toEqual(data)
  const message = () => db.select().from(MessageTable).where(eq(MessageTable.id, f.user.id)).get().pipe(Effect.orDie)
  const sequence = () =>
    db
      .select()
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, f.input.sessionID))
      .get()
      .pipe(Effect.orDie)
  return {
    f,
    stored,
    message,
    sequence,
    wire: { id: row.id, type: row.type, seq: row.seq, aggregateID: row.aggregate_id, data },
  }
})

it.instance(
  "exact legacy replay is idempotent for durable rows, projection, sequence, and live listeners",
  () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { f, wire, message, sequence } = yield* legacyReplayFixture
      const before = { rows: yield* f.rows(), message: yield* message(), sequence: yield* sequence() }
      const received: unknown[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const exit = yield* events.replay(wire, { publish: true }).pipe(Effect.exit)
      expect(Exit.isSuccess(exit)).toBe(true)
      expect({ rows: yield* f.rows(), message: yield* message(), sequence: yield* sequence() }).toEqual(before)
      expect(received).toEqual([])
    }),
  { git: true },
)

it.instance(
  "legacy replay with a one-byte agent change still diverges",
  () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { f, wire, message, sequence } = yield* legacyReplayFixture
      const before = { rows: yield* f.rows(), message: yield* message(), sequence: yield* sequence() }
      expect(wire.data.info.agent).toBe("build")
      const incoming = structuredClone(wire)
      incoming.data.info.agent = "builD"
      const exit = yield* events.replay(incoming).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(String(exit)).toContain("Replay diverged")
      expect({ rows: yield* f.rows(), message: yield* message(), sequence: yield* sequence() }).toEqual(before)
    }),
  { git: true },
)

it.instance(
  "legacy replay ignores transformed patch differences and retains the old projected patch",
  () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { f, wire, message, sequence } = yield* legacyReplayFixture
      const before = { rows: yield* f.rows(), message: yield* message(), sequence: yield* sequence() }
      const incoming = structuredClone(wire)
      expect(incoming.data.info.summary.diffs[0]!.patch).toBe("+old")
      incoming.data.info.summary.diffs[0]!.patch = "+olD"
      // Both patches map to the same durable data. The message projection is the diffs
      // SSOT; durable replay does not provide patch idempotency or reproject exact retries.
      const exit = yield* events.replay(incoming).pipe(Effect.exit)
      expect(Exit.isSuccess(exit)).toBe(true)
      expect({ rows: yield* f.rows(), message: yield* message(), sequence: yield* sequence() }).toEqual(before)
      expect((yield* message())?.data.summary).toEqual(wire.data.info.summary)
      expect((yield* message())?.data.summary).not.toEqual(incoming.data.info.summary)
    }),
  { git: true },
)

it.instance(
  "concurrent summaries serialize the complete read-compute-publish cycle and retain newest diffs",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const snapshot = yield* Snapshot.Service
      const f = yield* fixture
      yield* f.finish()
      const oldReady = yield* Deferred.make<void>()
      const oldRelease = yield* Deferred.make<void>()
      const real = snapshot.diffFull
      let calls = 0
      Object.assign(snapshot, {
        diffFull: (...args: Parameters<typeof real>) =>
          Effect.gen(function* () {
            const call = ++calls
            const result = yield* real(...args)
            if (call === 1) {
              yield* Deferred.succeed(oldReady, undefined)
              yield* Deferred.await(oldRelease)
            }
            return result
          }),
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(snapshot, { diffFull: real })))
      const old = yield* summary.summarize(f.input).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(oldReady), "old diff did not reach its gate")
      yield* Effect.promise(() => Bun.write(`${f.directory}/newest.txt`, "newest content\n"))
      yield* f.finish()
      const newest = yield* summary.computeDiff({
        messages: yield* sessions.messages({ sessionID: f.input.sessionID }).pipe(Effect.orDie),
      })
      expect(newest).toHaveLength(2)
      const newer = yield* summary.summarize(f.input).pipe(Effect.forkScoped)
      // This bounded observation asserts exclusion, not readiness. With serialization
      // disabled, the newer call completes while A is gated, then A overwrites it.
      const overlapped = yield* Effect.race(
        Fiber.join(newer).pipe(Effect.as(true)),
        Effect.sleep("250 millis").pipe(Effect.as(false)),
      )
      const latest = yield* summary.summarize(f.input).pipe(Effect.forkScoped)
      if (overlapped) yield* awaitWithTimeout(Fiber.join(latest), "latest unblocked call did not finish")
      yield* Deferred.succeed(oldRelease, undefined)
      yield* awaitWithTimeout(Fiber.join(old), "old summary did not finish")
      yield* awaitWithTimeout(Fiber.join(newer), "newer summary did not finish")
      yield* awaitWithTimeout(Fiber.join(latest), "latest summary did not finish")
      const actual = yield* summary.diff(f.input)
      process.stdout.write(
        `SUMMARY_CONCURRENCY ${JSON.stringify({ overlapped, expected: newest.map((x) => x.file), actual: actual.map((x) => x.file) })}\n`,
      )
      expect(actual).toEqual(newest)
      expect(overlapped).toBe(false)
    }),
  { git: true },
)

it.instance(
  "a blocked summary does not block another message and interruption releases its lock",
  () =>
    Effect.gen(function* () {
      const summary = yield* SessionSummary.Service
      const snapshot = yield* Snapshot.Service
      const first = yield* fixture
      yield* first.finish()
      const second = yield* fixture
      yield* Effect.promise(() => Bun.write(`${second.directory}/independent.txt`, "independent\n"))
      yield* second.finish()
      const ready = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const real = snapshot.diffFull
      let calls = 0
      Object.assign(snapshot, {
        diffFull: (...args: Parameters<typeof real>) =>
          Effect.gen(function* () {
            const call = ++calls
            const result = yield* real(...args)
            if (call === 1) {
              yield* Deferred.succeed(ready, undefined)
              yield* Deferred.await(release)
            }
            return result
          }),
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(snapshot, { diffFull: real })))
      const blocked = yield* summary.summarize(first.input).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(ready), "first message did not reach gate")
      yield* awaitWithTimeout(summary.summarize(second.input), "independent message was blocked")
      expect((yield* summary.diff(second.input)).map((x) => x.file)).toContain("independent.txt")
      const waiting = yield* summary.summarize(first.input).pipe(Effect.forkScoped)
      yield* Fiber.interrupt(blocked)
      yield* awaitWithTimeout(Fiber.join(waiting), "interruption did not release first message lock")
      expect((yield* summary.diff(first.input)).map((x) => x.file)).toContain("changed.txt")
      // A fresh invocation after all prior users finish must still work.
      yield* awaitWithTimeout(summary.summarize(first.input), "completed lock entry was not reusable")
    }),
  { git: true },
)
