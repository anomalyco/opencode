import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import path from "path"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { MessageDiffTable, MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { eq } from "drizzle-orm"
import { MessageID, PartID } from "@/session/schema"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Database.node, EventV2.node, Session.node, SessionSummary.node, Snapshot.node])),
    httpApiLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

const userMessage = (sessionID: SessionV1.User["sessionID"], messageID: MessageID) =>
  ({
    id: messageID,
    sessionID,
    role: "user" as const,
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
  }) satisfies SessionV1.User

const withSession = (input?: Parameters<Session.Interface["create"]>[0]) =>
  Effect.acquireRelease(Session.use.create(input), (created) => Session.use.remove(created.id).pipe(Effect.ignore))

describe("session message diff events", () => {
  it.instance(
    "persists full turn patches outside message events and replays them independently",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "message-diff-event" })
        const messageID = MessageID.ascending()
        const message = {
          id: messageID,
          sessionID: session.id,
          role: "user" as const,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
        } satisfies SessionV1.User
        yield* Session.use.updateMessage(message)
        const assistant = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: Date.now() },
          parentID: messageID,
          agent: "build",
          modelID: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("test"),
          mode: "build",
          path: { cwd: test.directory, root: test.directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } satisfies SessionV1.Assistant)
        const snapshot = yield* Snapshot.Service
        const start = yield* snapshot.track()
        if (!start) return yield* Effect.die("expected initial snapshot")
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "turn.ts"), "turn patch".repeat(30_000)))
        const finish = yield* snapshot.track()
        if (!finish) return yield* Effect.die("expected finished snapshot")
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-start",
          snapshot: start,
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-finish",
          reason: "stop",
          snapshot: finish,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const summary = yield* SessionSummary.Service
        yield* summary.summarize({ sessionID: session.id, messageID })
        yield* summary.summarize({ sessionID: session.id, messageID })
        const summarized = (yield* Session.use.messages({ sessionID: session.id })).find(
          (item) => item.info.id === messageID,
        )?.info
        const initialDiffs = summarized?.role === "user" ? summarized.summary?.diffs : undefined
        const diff = initialDiffs?.[0]
        expect(diff?.patch).toContain("turn patch")

        const { db } = yield* Database.Service
        const unchangedEvents = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, session.id))
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie)
        const unchangedDiffEvents = unchangedEvents.filter((event) => event.type === "message.diff.updated.1")
        expect(unchangedDiffEvents).toHaveLength(1)
        expect(JSON.stringify(unchangedDiffEvents[0]?.data)).toContain("turn patch")

        yield* Effect.promise(() => Bun.write(path.join(test.directory, "turn.ts"), "changed turn patch".repeat(30_000)))
        const changed = yield* snapshot.track()
        if (!changed) return yield* Effect.die("expected changed snapshot")
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-finish",
          reason: "stop",
          snapshot: changed,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const expectedChangedDiffs = yield* summary.computeDiff({
          messages: (yield* Session.use.messages({ sessionID: session.id })).filter(
            (item) => item.info.id === messageID || (item.info.role === "assistant" && item.info.parentID === messageID),
          ),
        })
        yield* summary.summarize({ sessionID: session.id, messageID })
        const changedDiffs = (yield* Session.use.messages({ sessionID: session.id })).find(
          (item) => item.info.id === messageID,
        )?.info
        if (!changedDiffs || changedDiffs.role !== "user") return yield* Effect.die("expected changed user message")
        expect(changedDiffs.summary?.diffs).toEqual(expectedChangedDiffs)

        const events = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, session.id))
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie)
        const diffEvents = events.filter((event) => event.type === "message.diff.updated.1")
        expect(diffEvents).toHaveLength(2)
        expect(JSON.stringify(diffEvents[0]?.data)).toContain("turn patch")
        expect(JSON.stringify(diffEvents[1]?.data)).toContain("changed turn patch")
        expect(JSON.stringify(diffEvents[0]?.data).length).toBeGreaterThan(250_000)
        expect(JSON.stringify(diffEvents[1]?.data).length).toBeGreaterThan(250_000)

        const fullPatchEvents = events.filter((event) => JSON.stringify(event.data).includes("turn patch"))
        expect(fullPatchEvents.map((event) => event.type)).toEqual([
          "message.diff.updated.1",
          "message.diff.updated.1",
        ])
        expect(
          events
            .filter((event) => event.type === "message.updated.1")
            .every((event) => JSON.stringify(event.data).length < 250_000),
        ).toBe(true)

        const response = yield* requestInDirectory(
          `${pathFor(SessionPaths.diff, { sessionID: session.id })}?messageID=${messageID}`,
          test.directory,
        )
        expect(response.status).toBe(200)
        const responseDiffs = yield* response.json
        expect(responseDiffs).toEqual(expectedChangedDiffs)

        const messageResponse = yield* requestInDirectory(
          pathFor(SessionPaths.message, { sessionID: session.id, messageID }),
          test.directory,
        )
        expect(messageResponse.status).toBe(200)
        const messagePayload = (yield* messageResponse.json) as SessionV1.WithParts
        expect(
          messagePayload.info.role === "user" ? messagePayload.info.summary?.diffs : undefined,
        ).toEqual(expectedChangedDiffs)

        yield* db.delete(MessageDiffTable).where(eq(MessageDiffTable.session_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(MessageTable).where(eq(MessageTable.session_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(SessionTable).where(eq(SessionTable.id, session.id)).run().pipe(Effect.orDie)

        const event = yield* EventV2.Service
        yield* event.replayAll(
          events.map((item) => ({
            id: item.id,
            type: item.type,
            data: item.data,
            seq: item.seq,
            aggregateID: item.aggregate_id,
          })),
        )
        const replayed = (yield* Session.use.messages({ sessionID: session.id })).find(
          (item) => item.info.id === messageID,
        )?.info
        expect(replayed?.role === "user" ? replayed.summary?.diffs : undefined).toEqual(expectedChangedDiffs)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    { timeout: 30_000 },
  )

  it.instance(
    "a later full V1 replacement replaces the dedicated turn patch",
    () =>
      Effect.gen(function* () {
        const session = yield* withSession({ title: "replacement" })
        const messageID = MessageID.ascending()
        const user = userMessage(session.id, messageID)
        yield* Session.use.updateMessage(user)
        const events = yield* EventV2.Service
        const first: Snapshot.FileDiff[] = [
          { file: "a.txt", additions: 1, deletions: 0, status: "modified", patch: "FIRST-PATCH" },
        ]
        yield* events.publish(Session.Event.MessageDiffUpdated, { sessionID: session.id, messageID, diffs: first })
        const read = Effect.fnUntraced(function* () {
          const info = (yield* Session.use.messages({ sessionID: session.id })).find(
            (item) => item.info.id === messageID,
          )?.info
          return info?.role === "user" ? info.summary?.diffs : undefined
        })
        expect(yield* read()).toEqual(first)

        const replacement: Snapshot.FileDiff[] = [
          { file: "b.txt", additions: 2, deletions: 1, status: "modified", patch: "REPLACEMENT-B" },
        ]
        yield* Session.use.updateMessage({ ...user, summary: { diffs: replacement } })
        expect(yield* read()).toEqual(replacement)

        yield* Session.use.updateMessage({ ...user, summary: { diffs: [] } })
        expect(yield* read()).toEqual([])

        const patchless: Snapshot.FileDiff[] = [{ file: "c.txt", additions: 0, deletions: 1, status: "deleted" }]
        yield* Session.use.updateMessage({ ...user, summary: { diffs: patchless } })
        expect(yield* read()).toEqual(patchless)

        // A complete V1 replacement with no summary retires the obsolete dedicated diff.
        yield* Session.use.updateMessage(user)
        expect(yield* read()).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "first summarize over an imported projection publishes a replayable baseline",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "imported" })
        const messageID = MessageID.ascending()
        const { db } = yield* Database.Service
        const created = Date.now()
        const importedDiffs: Snapshot.FileDiff[] = [
          { file: "old.txt", additions: 1, deletions: 0, status: "modified", patch: "STALE-IMPORTED-A" },
        ]
        yield* db
          .insert(MessageTable)
          .values({
            id: messageID,
            session_id: session.id,
            time_created: created,
            data: {
              role: "user",
              time: { created },
              agent: "build",
              model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
              summary: { title: "IMPORTED-TITLE", body: "IMPORTED-BODY", diffs: importedDiffs },
            } as never,
          })
          .run()
          .pipe(Effect.orDie)
        const assistant = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: Date.now() },
          parentID: messageID,
          agent: "build",
          modelID: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("test"),
          mode: "build",
          path: { cwd: test.directory, root: test.directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } satisfies SessionV1.Assistant)
        const snapshot = yield* Snapshot.Service
        const start = yield* snapshot.track()
        if (!start) return yield* Effect.die("expected initial snapshot")
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "imported.ts"), "imported patch".repeat(30_000)))
        const finish = yield* snapshot.track()
        if (!finish) return yield* Effect.die("expected finished snapshot")
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-start",
          snapshot: start,
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-finish",
          reason: "stop",
          snapshot: finish,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const summary = yield* SessionSummary.Service
        const expected = yield* summary.computeDiff({
          messages: (yield* Session.use.messages({ sessionID: session.id })).filter(
            (item) => item.info.id === messageID || (item.info.role === "assistant" && item.info.parentID === messageID),
          ),
        })
        expect(expected.length).toBeGreaterThan(0)
        expect(JSON.stringify(expected)).toContain("imported patch")
        yield* summary.summarize({ sessionID: session.id, messageID })
        const live = (yield* Session.use.messages({ sessionID: session.id })).find(
          (item) => item.info.id === messageID,
        )?.info
        expect(live?.role === "user" ? live.summary : undefined).toEqual({
          title: "IMPORTED-TITLE",
          body: "IMPORTED-BODY",
          diffs: expected,
        })

        const events = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, session.id))
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie)
        const baselineEvent = events.find(
          (item) => item.type === "message.updated.1" && JSON.stringify(item.data).includes("IMPORTED-TITLE"),
        )
        expect(baselineEvent).toBeDefined()
        expect(JSON.parse(JSON.stringify(baselineEvent?.data))).toMatchObject({
          info: {
            id: messageID,
            role: "user",
            summary: { title: "IMPORTED-TITLE", body: "IMPORTED-BODY", diffs: [] },
          },
        })
        expect(JSON.stringify(baselineEvent?.data)).not.toContain("STALE-IMPORTED-A")
        expect(JSON.stringify(baselineEvent?.data)).not.toContain("imported patch")
        const diffEvents = events.filter((item) => item.type === "message.diff.updated.1")
        expect(diffEvents).toHaveLength(1)
        expect(diffEvents[0]?.data).toMatchObject({ messageID, diffs: expected })

        yield* db.delete(MessageDiffTable).where(eq(MessageDiffTable.session_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(MessageTable).where(eq(MessageTable.session_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(SessionTable).where(eq(SessionTable.id, session.id)).run().pipe(Effect.orDie)

        const event = yield* EventV2.Service
        yield* event.replayAll(
          events.map((item) => ({
            id: item.id,
            type: item.type,
            data: item.data,
            seq: item.seq,
            aggregateID: item.aggregate_id,
          })),
        )
        const replayed = (yield* Session.use.messages({ sessionID: session.id })).find(
          (item) => item.info.id === messageID,
        )?.info
        expect(replayed?.role === "user" ? replayed.summary : undefined).toEqual({
          title: "IMPORTED-TITLE",
          body: "IMPORTED-BODY",
          diffs: expected,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
    { timeout: 30_000 },
  )

  it.instance(
    "first summarize over an imported projection without a summary publishes a replayable baseline",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "imported-no-summary" })
        const messageID = MessageID.ascending()
        const { db } = yield* Database.Service
        const created = Date.now()
        yield* db
          .insert(MessageTable)
          .values({
            id: messageID,
            session_id: session.id,
            time_created: created,
            data: {
              role: "user",
              time: { created },
              agent: "build",
              model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
            } as never,
          })
          .run()
          .pipe(Effect.orDie)
        const assistant = yield* Session.use.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: Date.now() },
          parentID: messageID,
          agent: "build",
          modelID: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("test"),
          mode: "build",
          path: { cwd: test.directory, root: test.directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } satisfies SessionV1.Assistant)
        const snapshot = yield* Snapshot.Service
        const start = yield* snapshot.track()
        if (!start) return yield* Effect.die("expected initial snapshot")
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "imported.ts"), "imported patch".repeat(30_000)))
        const finish = yield* snapshot.track()
        if (!finish) return yield* Effect.die("expected finished snapshot")
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-start",
          snapshot: start,
        })
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-finish",
          reason: "stop",
          snapshot: finish,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const summary = yield* SessionSummary.Service
        const expected = yield* summary.computeDiff({
          messages: (yield* Session.use.messages({ sessionID: session.id })).filter(
            (item) => item.info.id === messageID || (item.info.role === "assistant" && item.info.parentID === messageID),
          ),
        })
        expect(expected.length).toBeGreaterThan(0)
        yield* summary.summarize({ sessionID: session.id, messageID })
        const live = (yield* Session.use.messages({ sessionID: session.id })).find(
          (item) => item.info.id === messageID,
        )?.info
        expect(live?.role === "user" ? live.summary?.diffs : undefined).toEqual(expected)

        const events = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, session.id))
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie)
        expect(
          events.some((item) => item.type === "message.updated.1" && JSON.stringify(item.data).includes(messageID)),
        ).toBe(true)

        yield* db.delete(MessageDiffTable).where(eq(MessageDiffTable.session_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(MessageTable).where(eq(MessageTable.session_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, session.id)).run().pipe(Effect.orDie)
        yield* db.delete(SessionTable).where(eq(SessionTable.id, session.id)).run().pipe(Effect.orDie)

        const event = yield* EventV2.Service
        yield* event.replayAll(
          events.map((item) => ({
            id: item.id,
            type: item.type,
            data: item.data,
            seq: item.seq,
            aggregateID: item.aggregate_id,
          })),
        )
        const replayed = (yield* Session.use.messages({ sessionID: session.id })).find(
          (item) => item.info.id === messageID,
        )?.info
        expect(replayed).toBeDefined()
        expect(replayed?.role === "user" ? replayed.summary?.diffs : undefined).toEqual(expected)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    { timeout: 30_000 },
  )

  it.instance(
    "removing a message drops its dedicated diff row through the projector",
    () =>
      Effect.gen(function* () {
        const session = yield* withSession({ title: "removed-diff-row" })
        const messageID = MessageID.ascending()
        yield* Session.use.updateMessage(userMessage(session.id, messageID))
        const events = yield* EventV2.Service
        yield* events.publish(Session.Event.MessageDiffUpdated, {
          sessionID: session.id,
          messageID,
          diffs: [{ file: "removed.txt", additions: 1, deletions: 0, status: "modified", patch: "REMOVED-PATCH" }],
        })
        const { db } = yield* Database.Service
        const projected = yield* db
          .select()
          .from(MessageDiffTable)
          .where(eq(MessageDiffTable.message_id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(projected).toBeDefined()

        yield* Session.use.removeMessage({ sessionID: session.id, messageID })
        const diffRow = yield* db
          .select()
          .from(MessageDiffTable)
          .where(eq(MessageDiffTable.message_id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(diffRow).toBeUndefined()
        const messageRow = yield* db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(messageRow).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "a diff for a removed message is ignored rather than aborting projection",
    () =>
      Effect.gen(function* () {
        const session = yield* withSession({ title: "removed" })
        const messageID = MessageID.ascending()
        yield* Session.use.updateMessage(userMessage(session.id, messageID))
        const events = yield* EventV2.Service
        yield* events.publish(SessionV1.Event.MessageRemoved, { sessionID: session.id, messageID })
        const { db } = yield* Database.Service
        const removed = yield* db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(removed).toBeUndefined()

        yield* events.publish(Session.Event.MessageDiffUpdated, {
          sessionID: session.id,
          messageID,
          diffs: [{ file: "late.txt", additions: 1, deletions: 0, status: "modified", patch: "LATE-PATCH" }],
        })
        const orphan = yield* db
          .select()
          .from(MessageDiffTable)
          .where(eq(MessageDiffTable.message_id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(orphan).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "deleting a message cascades its dedicated diff row",
    () =>
      Effect.gen(function* () {
        const session = yield* withSession({ title: "cascade" })
        const messageID = MessageID.ascending()
        yield* Session.use.updateMessage(userMessage(session.id, messageID))
        const events = yield* EventV2.Service
        yield* events.publish(Session.Event.MessageDiffUpdated, {
          sessionID: session.id,
          messageID,
          diffs: [{ file: "cascade.txt", additions: 1, deletions: 0, status: "modified", patch: "CASCADE-PATCH" }],
        })
        const { db } = yield* Database.Service
        const projected = yield* db
          .select()
          .from(MessageDiffTable)
          .where(eq(MessageDiffTable.message_id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(projected).toBeDefined()

        yield* db.delete(MessageTable).where(eq(MessageTable.id, messageID)).run().pipe(Effect.orDie)
        const cascaded = yield* db
          .select()
          .from(MessageDiffTable)
          .where(eq(MessageDiffTable.message_id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(cascaded).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
