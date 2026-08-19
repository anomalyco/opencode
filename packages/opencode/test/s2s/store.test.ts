// Session-to-Session — Task 2 (store CRUD test).
//
// The store is a thin SQL layer over the s2s_* tables added in
// `packages/core/src/database/migration/20260616101412_s2s_tables.ts`.
// This test exercises every public method against a real in-memory
// `Database.Service` so the multi-statement claim+accept transactions
// (the cross-process safety boundary) run on actual SQLite, not mocks.
//
// Mirrors the shared-`:memory:` + `Database.layerFromPath` pattern used by
// `packages/core/test/move-session.test.ts` and `credential.test.ts`:
// the database layer is a module-level constant so every test inside
// this file shares one in-memory instance (Bun's `Database(":memory:")`
// creates a new in-memory DB per native handle — sharing the layer
// guarantees all `Database.Service` consumers see the same handle and
// therefore the same set of migrations).

import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { S2SStore } from "../../src/s2s/store"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const database = Database.layerFromPath(":memory:")
const it = testEffect(S2SStore.layer.pipe(Layer.provide(database)))

// Two valid arbitrary session ids for table-row targets.
const S1 = SessionID.make("ses_target_alpha")
const S2 = SessionID.make("ses_target_beta")
const S3 = SessionID.make("ses_target_gamma")
const S4 = SessionID.make("ses_target_delta")
const INVITER = SessionID.make("ses_inviter_one")
const JOINER = SessionID.make("ses_joiner_one")

describe("S2SStore", () => {
  it.effect("claimForSessions drains and de-duplicates a row", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertInbox({
        id: "inb_1",
        targetSessionID: S1,
        fromSessionID: INVITER,
        fromSlug: "inviter",
        capsule: '{"body":"hi"}',
        timeCreated: 1_700_000_000_000,
      })

      const first = yield* store.claimForSessions([S1])
      expect(first).toHaveLength(1)
      expect(first[0]?.id).toBe("inb_1")
      expect(first[0]?.targetSessionID).toBe(S1)
      expect(first[0]?.fromSessionID).toBe(INVITER)
      expect(first[0]?.fromSlug).toBe("inviter")
      expect(first[0]?.capsule).toBe('{"body":"hi"}')

      const second = yield* store.claimForSessions([S1])
      expect(second).toEqual([])
    }),
  )

  it.effect("claimForSessions scopes rows to the requested session ids", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertInbox({
        id: "inb_scoped",
        targetSessionID: S1,
        fromSessionID: INVITER,
        fromSlug: "inviter",
        capsule: "x",
        timeCreated: 1,
      })

      // Ask for a different session — the row targeted at S1 must NOT come back.
      const drained = yield* store.claimForSessions([S2])
      expect(drained).toEqual([])

      // Original target still gets it.
      const first = yield* store.claimForSessions([S1])
      expect(first.map((r) => r.id)).toEqual(["inb_scoped"])
    }),
  )

  it.effect("reapStale resets a stale claim so a follow-up claim succeeds", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertInbox({
        id: "inb_stale",
        targetSessionID: S1,
        fromSessionID: INVITER,
        fromSlug: "inviter",
        capsule: "x",
        timeCreated: 1,
      })

      const claimed = yield* store.claimForSessions([S1])
      expect(claimed).toHaveLength(1)

      // Immediately after, the claim is held — nothing to drain.
      const stillHeld = yield* store.claimForSessions([S1])
      expect(stillHeld).toEqual([])

      // Reap everything older than now+1s. The previous claim's drained_at
      // is approximately Date.now() (very small), so reaping at now+1s
      // captures it and reopens the row.
      yield* store.reapStale(Date.now() + 1_000)

      const reclaimed = yield* store.claimForSessions([S1])
      expect(reclaimed.map((r) => r.id)).toEqual(["inb_stale"])
    }),
  )

  it.effect("a delivered (deleteInbox'd) row is NOT redelivered by reapStale", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertInbox({
        id: "inb_delivered",
        targetSessionID: S1,
        fromSessionID: INVITER,
        fromSlug: "inviter",
        capsule: "x",
        timeCreated: 1,
      })

      // Claim (delivered into the in-process inbox) then hard-delete — the
      // exact poller/D-drain sequence after a successful enqueue.
      const claimed = yield* store.claimForSessions([S1])
      expect(claimed.map((r) => r.id)).toEqual(["inb_delivered"])
      yield* store.deleteInbox("inb_delivered")

      // Reaper runs far in the future. Before the deleteInbox fix this reset
      // the delivered row's drained_at to NULL and redelivered it forever;
      // now the row is gone, so the reaper has nothing to resurrect.
      yield* store.reapStale(Date.now() + 1_000_000)
      const afterReap = yield* store.claimForSessions([S1])
      expect(afterReap).toEqual([])

      // countUndelivered also reflects the delete (durable INBOX_CAP basis).
      expect(yield* store.countUndelivered(S1)).toBe(0)
    }),
  )

  it.effect("reapStale STILL redelivers a crashed claim (claimed, never deleted)", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertInbox({
        id: "inb_crashed",
        targetSessionID: S2,
        fromSessionID: INVITER,
        fromSlug: "inviter",
        capsule: "x",
        timeCreated: 1,
      })

      // Claim but DO NOT delete — simulates a delivering fiber that died
      // between claim and deleteInbox. The reaper must reopen this one.
      yield* store.claimForSessions([S2])
      yield* store.reapStale(Date.now() + 1_000_000)
      const reclaimed = yield* store.claimForSessions([S2])
      expect(reclaimed.map((r) => r.id)).toEqual(["inb_crashed"])
    }),
  )

  it.effect("claimToken accepts a single use and rejects a second claim", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertToken({
        token: "tok_abc",
        inviterSessionID: INVITER,
        inviterSlug: "inviter",
        createdAt: Date.now(),
      })

      const first = yield* store.claimToken("tok_abc", JOINER)
      expect(Option.isSome(first)).toBe(true)
      if (Option.isSome(first)) {
        expect(first.value.token).toBe("tok_abc")
        expect(first.value.inviterSessionID).toBe(INVITER)
        expect(first.value.inviterSlug).toBe("inviter")
      }

      const second = yield* store.claimToken("tok_abc", JOINER)
      expect(Option.isNone(second)).toBe(true)
    }),
  )

  it.effect("allow list is directional: insertAllow(a,b) does not imply isAllowed(b,a)", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertAllow(S1, S2)

      expect(yield* store.isAllowed(S1, S2)).toBe(true)
      expect(yield* store.isAllowed(S2, S1)).toBe(false)
    }),
  )

  it.effect("listAllows returns every inbound and outbound row for a session", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertAllow(S3, S4)
      yield* store.insertAllow(S4, S3)
      yield* store.insertAllow(S2, S3)

      const rows = yield* store.listAllows(S3)
      expect(rows).toHaveLength(3)
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sessionID: S3, allowedSessionID: S4 }),
          expect.objectContaining({ sessionID: S4, allowedSessionID: S3 }),
          expect.objectContaining({ sessionID: S2, allowedSessionID: S3 }),
        ]),
      )
    }),
  )

  it.effect("deleteAllow removes a previously-allowed pair", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service

      yield* store.insertAllow(S1, S2)
      expect(yield* store.isAllowed(S1, S2)).toBe(true)

      yield* store.deleteAllow(S1, S2)
      expect(yield* store.isAllowed(S1, S2)).toBe(false)
    }),
  )
})
