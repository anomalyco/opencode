import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session as SessionNs } from "@/session/session"
import { SubagentLimits } from "@/session/subagent-limits"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { SessionID } from "@/session/schema"
import { testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Storage.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provideMerge(EventV2Bridge.defaultLayer),
      Layer.provide(SessionProjector.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    Database.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    testInstanceStoreLayer,
  ),
)

/**
 * Seeds the per-session cost/token aggregate directly in the database — the
 * same DB-seam pattern session-lineage.test.ts uses to corrupt parent rows.
 * Mirrors what the projector accumulates from step-finish parts, without
 * having to drive a full prompt loop.
 */
const seedUsage = (
  sessionID: SessionID,
  usage: { cost: number; input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number },
) =>
  Database.Service.use(({ db }) =>
    db
      .update(SessionTable)
      .set({
        cost: usage.cost,
        tokens_input: usage.input ?? 0,
        tokens_output: usage.output ?? 0,
        tokens_reasoning: usage.reasoning ?? 0,
        tokens_cache_read: usage.cacheRead ?? 0,
        tokens_cache_write: usage.cacheWrite ?? 0,
      })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie),
  )

describe("SubagentLimits.aggregateCost", () => {
  it.effect("sums cost and every token bucket across the subtree", () => {
    const rollup = SubagentLimits.aggregateCost([
      {
        cost: 1.5,
        tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 3, write: 1 } },
      },
      {
        cost: 0.25,
        tokens: { input: 4, output: 6, reasoning: 0, cache: { read: 2, write: 7 } },
      },
    ])
    expect(rollup).toEqual({
      cost: 1.75,
      tokens: { input: 14, output: 26, reasoning: 5, cache: { read: 5, write: 8 } },
    })
    return Effect.void
  })

  it.effect("treats missing cost/tokens as zero", () => {
    const rollup = SubagentLimits.aggregateCost([{}, { cost: 2 }, { tokens: undefined }])
    expect(rollup).toEqual({
      cost: 2,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    return Effect.void
  })

  it.effect("is an empty zero rollup for no nodes", () => {
    expect(SubagentLimits.aggregateCost([])).toEqual({
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    return Effect.void
  })
})

describe("Session-tree cost rollup", () => {
  it.instance("rolls a child's own usage plus its 2-level descendant subtree", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      // Tree: root → child → grandchild (a 3-level chain, the subagent task is
      // the `child`, so the rollup covers child + grandchild).
      const root = yield* sessions.create({})
      const child = yield* sessions.create({ parentID: root.id })
      const grandchild = yield* sessions.create({ parentID: child.id })

      yield* seedUsage(root.id, { cost: 10, input: 100 })
      yield* seedUsage(child.id, { cost: 2, input: 20, output: 5, cacheRead: 3 })
      yield* seedUsage(grandchild.id, { cost: 0.5, input: 7, reasoning: 4, cacheWrite: 9 })

      // The rollup of the task that spawned `child`: the child itself plus its
      // descendants — root (the spawner) is deliberately excluded.
      const subtree = yield* sessions.descendants(child.id)
      const childInfo = yield* sessions.get(child.id)
      const rollup = SubagentLimits.aggregateCost([childInfo, ...subtree])

      expect(rollup.cost).toBeCloseTo(2.5, 10)
      expect(rollup.tokens).toEqual({
        input: 27,
        output: 5,
        reasoning: 4,
        cache: { read: 3, write: 9 },
      })
    }),
  )

  it.instance("rolls a fan-out subtree (root → A,B → A1) without double counting the spawner", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const root = yield* sessions.create({})
      const a = yield* sessions.create({ parentID: root.id })
      const b = yield* sessions.create({ parentID: root.id })
      const a1 = yield* sessions.create({ parentID: a.id })

      yield* seedUsage(root.id, { cost: 99, input: 999 })
      yield* seedUsage(a.id, { cost: 1, input: 1 })
      yield* seedUsage(b.id, { cost: 2, input: 2 })
      yield* seedUsage(a1.id, { cost: 4, input: 4 })

      // Rollup for the task that spawned the whole subtree from `root`: every
      // descendant, but NOT root's own spend (the parent session still bills
      // its own cost separately — this is display-only, no double counting).
      const subtree = yield* sessions.descendants(root.id)
      const rollup = SubagentLimits.aggregateCost(subtree)

      expect(rollup.cost).toBe(7)
      expect(rollup.tokens.input).toBe(7)

      // The root session's own per-session accounting is unchanged by the
      // rollup read — the real bill is not touched.
      const rootInfo = yield* sessions.get(root.id)
      expect(rootInfo.cost).toBe(99)
      expect(rootInfo.tokens?.input).toBe(999)
    }),
  )
})
