import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
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
import { awaitWithTimeout, testEffect } from "../lib/effect"

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

/** Seeds a parent chain of `depth` sessions, ordered root → deepest. */
const seedChain = (depth: number) =>
  Effect.gen(function* () {
    const sessions = yield* SessionNs.Service
    const chain: SessionNs.Info[] = []
    for (let i = 0; i < depth; i++) {
      chain.push(yield* sessions.create({ parentID: chain.at(-1)?.id }))
    }
    return chain
  })

/** Rewires `sessionID`'s parent pointer directly in the database (corruption seeding). */
const setParent = (sessionID: SessionID, parentID: SessionID) =>
  Database.Service.use(({ db }) =>
    db
      .update(SessionTable)
      .set({ parent_id: parentID })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie),
  )

const deleteRow = (sessionID: SessionID) =>
  Database.Service.use(({ db }) =>
    db
      .delete(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie),
  )

describe("Session.lineage", () => {
  it.instance("root session has a single-element lineage", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const root = yield* sessions.create({})
      const chain = yield* sessions.lineage(root.id)
      expect(chain.map((info) => info.id)).toEqual([root.id])
    }),
  )

  it.instance("walks self → root over chains of depth 3 and 5", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const three = yield* seedChain(3)
      const chain3 = yield* sessions.lineage(three.at(-1)!.id)
      expect(chain3.map((info) => info.id)).toEqual(
        three
          .map((info) => info.id)
          .slice()
          .reverse(),
      )

      const five = yield* seedChain(5)
      const chain5 = yield* sessions.lineage(five.at(-1)!.id)
      expect(chain5.map((info) => info.id)).toEqual(
        five
          .map((info) => info.id)
          .slice()
          .reverse(),
      )
      expect(chain5.at(-1)!.id).toBe(five[0]!.id)
    }),
  )

  it.instance("fails with NotFound for an unknown session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const root = yield* sessions.create({})
      yield* deleteRow(root.id)
      const error = yield* sessions.lineage(root.id).pipe(Effect.flip)
      expect(error._tag).toBe("NotFoundError")
    }),
  )

  it.instance("treats orphans as roots when a parent row vanished mid-chain", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const chain = yield* seedChain(3)
      yield* deleteRow(chain[1]!.id)
      const result = yield* sessions.lineage(chain[2]!.id)
      expect(result.map((info) => info.id)).toEqual([chain[2]!.id])
    }),
  )

  it.instance("fails with SubagentLineageError on cyclic parent data instead of hanging", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const a = yield* sessions.create({})
      const b = yield* sessions.create({ parentID: a.id })
      yield* setParent(a.id, b.id)
      const error = yield* awaitWithTimeout(
        sessions.lineage(b.id).pipe(Effect.flip),
        "lineage hung on a parent cycle",
      )
      expect(error._tag).toBe("SubagentLineageError")
    }),
  )
})

describe("Session.descendants", () => {
  it.instance("collects the transitive subtree without the session itself", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const root = yield* sessions.create({})
      const childA = yield* sessions.create({ parentID: root.id })
      const childB = yield* sessions.create({ parentID: root.id })
      const grandA = yield* sessions.create({ parentID: childA.id })
      const grandB = yield* sessions.create({ parentID: childB.id })

      const result = yield* sessions.descendants(root.id)
      expect(result.map((info) => info.id).sort()).toEqual(
        [childA.id, childB.id, grandA.id, grandB.id].sort(),
      )
    }),
  )

  it.instance("returns an empty list for a leaf", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const root = yield* sessions.create({})
      expect(yield* sessions.descendants(root.id)).toEqual([])
    }),
  )

  it.instance("terminates on cyclic parent data", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const root = yield* sessions.create({})
      const a = yield* sessions.create({ parentID: root.id })
      const b = yield* sessions.create({ parentID: a.id })
      // children(b) now yields root again: root → a → b → root.
      yield* setParent(root.id, b.id)
      const result = yield* awaitWithTimeout(
        sessions.descendants(root.id),
        "descendants hung on a parent cycle",
      )
      expect(result.map((info) => info.id).sort()).toEqual([a.id, b.id].sort())
    }),
  )
})

describe("Session.create hard cap (HARD_MAX_DEPTH)", () => {
  it.instance("allows children up to depth 10", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const chain = yield* seedChain(9)
      const child = yield* sessions.create({ parentID: chain.at(-1)!.id })
      expect(child.parentID).toBe(chain.at(-1)!.id)
      expect((yield* sessions.lineage(child.id)).length).toBe(10)
    }),
  )

  it.instance("refuses depth 11 with a SubagentDepthError defect", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const chain = yield* seedChain(10)
      const exit = yield* sessions.create({ parentID: chain.at(-1)!.id }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) return
      const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect
      expect(defect).toBeInstanceOf(SubagentLimits.SubagentDepthError)
      const error = defect as SubagentLimits.SubagentDepthError
      expect(error.depth).toBe(11)
      expect(error.limit).toBe(SubagentLimits.HARD_MAX_DEPTH)
    }),
  )

  it.instance("refuses to create under a cyclic parent chain", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const a = yield* sessions.create({})
      const b = yield* sessions.create({ parentID: a.id })
      yield* setParent(a.id, b.id)
      const exit = yield* awaitWithTimeout(
        sessions.create({ parentID: b.id }).pipe(Effect.exit),
        "create hung on a parent cycle",
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) return
      const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect
      expect(defect).toBeInstanceOf(SubagentLimits.SubagentLineageError)
    }),
  )

  it.instance("keeps creating root sessions and orphan children unaffected", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const root = yield* sessions.create({})
      expect(root.parentID).toBeUndefined()
      // A parent that does not exist is treated like an orphan root (no cap hit).
      const orphanParent = yield* sessions.create({})
      yield* deleteRow(orphanParent.id)
      const child = yield* sessions.create({ parentID: orphanParent.id })
      expect(child.parentID).toBe(orphanParent.id)
    }),
  )
})
