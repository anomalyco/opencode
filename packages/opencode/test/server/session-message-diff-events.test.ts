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
    { git: true, config: { formatter: false, lsp: false }, timeout: 30_000 },
  )
})
