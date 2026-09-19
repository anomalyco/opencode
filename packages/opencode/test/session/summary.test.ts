import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { and, eq } from "drizzle-orm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
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
