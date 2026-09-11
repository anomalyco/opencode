/**
 * Regression test for the same bug class as #26574 (sibling of #26566 and
 * #26553). The Desktop app calls GET /session/<id>/diff; before #26574
 * the response was Schema-encoded against `Snapshot.FileDiff` with
 * `patch: Schema.String` (required), so any session whose stored
 * `summary_diffs` had a row without `patch` returned HTTP 400 and the
 * session never loaded. Legacy session-level diffs are no longer surfaced,
 * but the endpoint remains compatible and must still return successfully.
 *
 * This test inserts a session row with a missing-patch diff entry and
 * asserts that GET /session/<id>/diff returns 200 with empty data.
 */
import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import path from "path"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID } from "@/session/schema"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { and, eq, sql } from "drizzle-orm"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([Database.node, EventV2.node, Session.node, SessionSummary.node, Snapshot.node, Storage.node]),
    ),
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

const withSession = (input?: Parameters<Session.Interface["create"]>[0]) =>
  Effect.acquireRelease(Session.use.create(input), (created) => Session.use.remove(created.id).pipe(Effect.ignore))

describe("session diff with missing patch (#26574)", () => {
  it.instance(
    "GET /session/<id>/diff ignores legacy session-level diff storage",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "missing-patch" })

        // Mimic legacy/imported on-disk shape: a diff entry with no
        // `patch` text. Pre-fix the typed response encoder rejects
        // this and returns 400.
        yield* Storage.Service.use((storage) =>
          storage.write(["session_diff", session.id], [{ file: "legacy.txt", additions: 1, deletions: 0 }]),
        )

        const response = yield* requestInDirectory(
          pathFor(SessionPaths.diff, { sessionID: session.id }),
          test.directory,
        )

        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "GET /session/<id>/diff returns requested turn diffs",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "turn-diff" })
        const messageID = MessageID.ascending()
        yield* Session.use.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
          summary: {
            diffs: [{ file: "turn.ts", additions: 1, deletions: 0, status: "modified" }],
          },
        } satisfies SessionV1.User)

        const response = yield* requestInDirectory(
          `${pathFor(SessionPaths.diff, { sessionID: session.id })}?messageID=${messageID}`,
          test.directory,
        )

        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([{ file: "turn.ts", additions: 1, deletions: 0, status: "modified" }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps stored turn diffs while compacting later message update events",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "compact-turn-diff" })
        const messageID = MessageID.ascending()
        const diff = {
          file: "turn.ts",
          additions: 1,
          deletions: 0,
          patch: "x".repeat(262_144),
          status: "modified" as const,
        }
        const message = {
          id: messageID,
          sessionID: session.id,
          role: "user" as const,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
          summary: { diffs: [diff] },
        } satisfies SessionV1.User
        yield* Session.use.updateMessage(message)
        yield* Session.use.updateMessage({ ...message, tools: { read: true } })

        const { db } = yield* Database.Service
        const events = yield* db
          .select({ bytes: sql<number>`length(${EventTable.data})` })
          .from(EventTable)
          .where(
            and(
              eq(EventTable.aggregate_id, session.id),
              eq(EventTable.type, "message.updated.1"),
            ),
          )
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie)

        expect(events).toHaveLength(2)
        expect(events[0]?.bytes).toBeGreaterThan(diff.patch.length)
        expect(events[1]?.bytes).toBeLessThan(1_000)

        const response = yield* requestInDirectory(
          `${pathFor(SessionPaths.diff, { sessionID: session.id })}?messageID=${messageID}`,
          test.directory,
        )

        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([diff])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "persists changed turn diffs through a fresh event replay",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "changed-turn-diff" })
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
        const summary = yield* SessionSummary.Service
        const start = yield* snapshot.track()
        if (!start) return yield* Effect.die("expected initial snapshot")
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "first.ts"), "first"))
        const first = yield* snapshot.track()
        if (!first) return yield* Effect.die("expected first snapshot")
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
          snapshot: first,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        yield* summary.summarize({ sessionID: session.id, messageID })

        yield* Effect.promise(() => Bun.write(path.join(test.directory, "second.ts"), "second"))
        const second = yield* snapshot.track()
        if (!second) return yield* Effect.die("expected second snapshot")
        yield* Session.use.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-finish",
          reason: "stop",
          snapshot: second,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        yield* summary.summarize({ sessionID: session.id, messageID })

        const { db } = yield* Database.Service
        const before = yield* db
          .select({ data: MessageTable.data })
          .from(MessageTable)
          .where(eq(MessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(before?.data).toMatchObject({
          role: "user",
          summary: { diffs: [{ file: "first.ts" }, { file: "second.ts" }] },
        })

        const events = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, session.id))
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie)
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

        const after = yield* db
          .select({ data: MessageTable.data })
          .from(MessageTable)
          .where(eq(MessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        expect(after?.data).toMatchObject({
          role: "user",
          summary: { diffs: [{ file: "first.ts" }, { file: "second.ts" }] },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
