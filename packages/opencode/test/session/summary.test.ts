import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { node as DatabaseNode } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Session } from "@/session/session"
import {
  MAX_SUMMARY_DIFF_BYTES,
  MAX_SUMMARY_FILE_PATCH_BYTES,
  truncateDiffs,
} from "../../src/session/summary"
import type { Snapshot } from "../../src/snapshot"
import {
  disposeAllInstances,
  testInstanceStoreLayer,
  } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = Layer.mergeAll(
  LayerNode.compile(LayerNode.group([Session.node, CrossSpawnSpawner.node, DatabaseNode])),
  testInstanceStoreLayer,
)
const withLayer = testEffect(layer)

const withSessionRow = Effect.fn("SummaryTest.withSessionRow")(function* () {
  const sessions = yield* Session.Service
  const { db } = yield* Database.Service
  const info = yield* sessions.create({})
  yield* db
    .insert(SessionTable)
    .values({
      id: info.id,
      project_id: info.projectID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      version: info.version,
      time_created: info.time.created,
      time_updated: info.time.updated,
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  return info
})

const diff = (file: string, patchSize: number): Snapshot.FileDiff =>
  ({
    file,
    patch: "x".repeat(patchSize),
    additions: patchSize,
    deletions: 0,
  }) as Snapshot.FileDiff

describe("summary diff cap", () => {
  test("passes small diffs through untouched", () => {
    const input = [diff("a.ts", 100), diff("b.ts", 200)]
    expect(truncateDiffs(input)).toEqual(input)
  })

  test("caps single-file patches and keeps totals", () => {
    const out = truncateDiffs([diff("big.ts", MAX_SUMMARY_FILE_PATCH_BYTES + 1000)])
    expect(out.length).toBe(1)
    expect(out[0].patch!.length).toBeLessThanOrEqual(MAX_SUMMARY_FILE_PATCH_BYTES + 100)
    expect(out[0].patch).toContain("[diff truncated")
    expect(out[0].additions).toBe(MAX_SUMMARY_FILE_PATCH_BYTES + 1000)
  })

  test("bounds the total across files", () => {
    const input = Array.from({ length: 20 }, (_, i) => diff(`f${i}.ts`, 100 * 1024))
    const out = truncateDiffs(input)
    const total = out.reduce((sum, item) => sum + (item.patch?.length ?? 0), 0)
    expect(total).toBeLessThanOrEqual(MAX_SUMMARY_DIFF_BYTES)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out.length).toBeLessThan(input.length)
  })

  test("empty stays empty", () => {
    expect(truncateDiffs([])).toEqual([])
  })
})

describe("pruneMessageEvents", () => {
  const putEvent = (aggregateID: string, seq: number, type: string, messageID: string, bytes: number) =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(EventSequenceTable)
        .values({ aggregate_id: aggregateID, seq, owner_id: null })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(EventTable)
        .values({
          id: `evt_prune_${seq}` as never,
          aggregate_id: aggregateID,
          seq,
          type,
          data: {
            sessionID: aggregateID,
            info: { id: messageID, padding: "x".repeat(bytes) },
          },
        })
        .run()
        .pipe(Effect.orDie)
    })

  const updatedCount = (aggregateID: string) =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const rows = yield* db.select().from(EventTable).all().pipe(Effect.orDie)
      return rows.filter((row) => row.aggregate_id === aggregateID && row.type.startsWith("message.updated")).length
    })

  withLayer.instance("keeps only the newest snapshot per message", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* withSessionRow()
      yield* putEvent(session.id, 1, "message.updated.1", "msg_a", 200 * 1024)
      yield* putEvent(session.id, 2, "message.updated.1", "msg_a", 200 * 1024)
      yield* putEvent(session.id, 3, "message.updated.1", "msg_a", 200 * 1024)
      yield* putEvent(session.id, 4, "message.updated.1", "msg_b", 100)
      yield* putEvent(session.id, 5, "message.created.1", "msg_a", 100)
      const pruned = yield* sessions.pruneMessageEvents({ sessionID: session.id, messageID: "msg_a" as never })
      expect(pruned).toBe(2)
      const remaining = yield* pollWithTimeout(
        Effect.gen(function* () {
          const count = yield* updatedCount(session.id)
          if (count !== 2) return undefined
          return count
        }),
        "superseded snapshots were not pruned",
      )
      expect(remaining).toBe(2)
    }),
  )
})
