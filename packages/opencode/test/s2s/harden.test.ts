// Session-to-Session — bounded retry + GC tests.
//
// Verifies two cross-process safety mechanisms:
//   1. retryOnBusy — bounded retry on SQLITE_BUSY / lock-timeout errors,
//      immediate fail on non-retryable SQL errors.
//   2. deleteOrphaned — removes s2s rows whose referenced session no
//      longer exists, without touching rows that reference live sessions.

import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { LockTimeoutError, ConstraintError, SqlError } from "effect/unstable/sql/SqlError"
import { sql } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { S2SStore, isRetryableSqlError, retryOnBusy } from "../../src/s2s/store"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

// ──────────────────────────────────────────────────────────────────
// Helpers — synthesize the exact error chain the store sees at runtime
// ──────────────────────────────────────────────────────────────────

function makeRetryableError(cause: unknown): EffectDrizzleQueryError {
  const reason = new LockTimeoutError({ cause })
  const sqlErr = new SqlError({ reason })
  return new EffectDrizzleQueryError({
    query: "INSERT INTO s2s_inbox ...",
    params: [],
    cause: Cause.fail(sqlErr),
  })
}

function makeNonRetryableError(cause: unknown): EffectDrizzleQueryError {
  const reason = new ConstraintError({ cause })
  const sqlErr = new SqlError({ reason })
  return new EffectDrizzleQueryError({
    query: "INSERT INTO s2s_inbox ...",
    params: [],
    cause: Cause.fail(sqlErr),
  })
}

// ──────────────────────────────────────────────────────────────────
// Predicate tests — pure, no DB required
// ──────────────────────────────────────────────────────────────────

describe("isRetryableSqlError", () => {
  test("returns true for LockTimeoutError", () => {
    const locked = makeRetryableError(new Error("database is locked"))
    expect(isRetryableSqlError(locked)).toBe(true)
  })

  test("returns false for ConstraintError", () => {
    const constraint = makeNonRetryableError(new Error("NOT NULL constraint"))
    expect(isRetryableSqlError(constraint)).toBe(false)
  })

  test("returns false for non-Drizzle errors", () => {
    expect(isRetryableSqlError(new Error("plain error"))).toBe(false)
    expect(isRetryableSqlError(null)).toBe(false)
    expect(isRetryableSqlError(undefined)).toBe(false)
    expect(isRetryableSqlError({ cause: { something: 1 } })).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────
// Retry combinator tests — synthetic effects, pure (no DB)
// ──────────────────────────────────────────────────────────────────

// Returns an effect that fails `failCount` times with `error`, then succeeds.
function flakyEffect(failCount: number, error: unknown): Effect.Effect<string, unknown> {
  let attempts = 0
  return Effect.suspend(() => {
    attempts++
    if (attempts <= failCount) return Effect.fail(error)
    return Effect.succeed("ok")
  })
}

describe("retryOnBusy", () => {
  test("succeeds after 2 retryable failures (within cap of 4)", async () => {
    const err = makeRetryableError(new Error("database is locked"))
    const result = await Effect.runPromise(retryOnBusy(flakyEffect(2, err)))
    expect(result).toBe("ok")
  })

  test("fails immediately on a non-retryable error (zero retries)", async () => {
    const err = makeNonRetryableError(new Error("NOT NULL constraint"))
    const exit = await retryOnBusy(flakyEffect(1, err)).pipe(Effect.exit).pipe(Effect.runPromise)
    // If the predicate incorrectly retries, the effect would succeed after
    // the first failure. A failure exit proves the predicate stopped it.
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("fails after exceeding retry cap even on retryable errors", async () => {
    // RETRY_MAX = 4 → 1 initial + 4 retries = 5 total attempts.
    // Fail 5 times means the 5th failure exhausts the cap.
    const err = makeRetryableError(new Error("database is locked"))
    const exit = await retryOnBusy(flakyEffect(5, err)).pipe(Effect.exit).pipe(Effect.runPromise)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("does not retry non-Drizzle errors at all", async () => {
    const plainErr = new Error("plain error")
    const exit = await retryOnBusy(Effect.fail(plainErr)).pipe(Effect.exit).pipe(Effect.runPromise)
    expect(Exit.isFailure(exit)).toBe(true)
    // The failure should be the plain error, not wrapped
    if (Exit.isFailure(exit)) {
      const extracted = Cause.findErrorOption(exit.cause)
      expect(Option.isSome(extracted)).toBe(true)
      if (Option.isSome(extracted)) {
        expect(extracted.value).toBe(plainErr)
      }
    }
  })
})

// ──────────────────────────────────────────────────────────────────
// GC tests — real SQLite via the shared in-memory layer
// ──────────────────────────────────────────────────────────────────

// Use provideMerge so Database.Service is also available in the test
// body for inserting the session row needed by deleteOrphaned tests.
const database = Database.layerFromPath(":memory:")
const it = testEffect(S2SStore.layer.pipe(Layer.provideMerge(database)))

const LIVE = SessionID.make("ses_live_session")
const ORPHAN = SessionID.make("ses_orphan_gone")

describe("S2SStore.deleteOrphaned", () => {
  it.effect("deletes only rows whose referenced session no longer exists", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service
      const { db } = yield* Database.Service

      // Insert a LIVE session row. Disable FK checks first because the
      // `project` table is empty in this test DB. We only need the row
      // for the NOT IN subquery — the FK constraint is irrelevant here.
      yield* db.run(sql`PRAGMA foreign_keys = OFF`)
      yield* db.run(sql`
        INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES (${LIVE}, 'proj_test', 'test', '/tmp/test', 'Test', '1', ${Date.now()}, ${Date.now()})
      `).pipe(Effect.catch((e) =>
        Effect.logError("failed to insert session row", { error: String(e) }),
      ))
      yield* db.run(sql`PRAGMA foreign_keys = ON`)

      // Populate s2s tables — some rows target LIVE, some target ORPHAN
      // (which has no session row).
      // --- inbox ---
      yield* store.insertInbox({
        id: "inb_live",
        targetSessionID: LIVE,
        fromSessionID: ORPHAN,
        fromSlug: "orphan",
        capsule: "{}",
        timeCreated: 1,
      }).pipe(Effect.catch(() => Effect.void))
      yield* store.insertInbox({
        id: "inb_orphan",
        targetSessionID: ORPHAN,
        fromSessionID: LIVE,
        fromSlug: "live",
        capsule: "{}",
        timeCreated: 2,
      }).pipe(Effect.catch(() => Effect.void))

      // --- allow ---
      yield* store.insertAllow(LIVE, ORPHAN).pipe(Effect.catch(() => Effect.void))
      yield* store.insertAllow(ORPHAN, LIVE).pipe(Effect.catch(() => Effect.void))

      // --- token ---
      yield* store.insertToken({
        token: "tok_orphan_inviter",
        inviterSessionID: ORPHAN,
        inviterSlug: "orphan",
        createdAt: Date.now(),
      }).pipe(Effect.catch(() => Effect.void))
      yield* store.insertToken({
        token: "tok_live_inviter",
        inviterSessionID: LIVE,
        inviterSlug: "live",
        createdAt: Date.now(),
      }).pipe(Effect.catch(() => Effect.void))

      // Run GC
      yield* store.deleteOrphaned()

      // Verify: ONLY orphan rows are gone
      const inbox = yield* store.claimForSessions([LIVE, ORPHAN])
      const inboxIds = inbox.map((r) => r.id)
      expect(inboxIds).toContain("inb_live")
      expect(inboxIds).not.toContain("inb_orphan")

      // LIVE→ORPHAN: session_id=LIVE (exists), allowed_session_id=ORPHAN (gone)
      // → should be deleted (OR part of the WHERE clause)
      expect(yield* store.isAllowed(LIVE, ORPHAN)).toBe(false)
      // ORPHAN→LIVE: session_id=ORPHAN (gone), allowed_session_id=LIVE (exists)
      // → should be deleted (session_id NOT IN)
      expect(yield* store.isAllowed(ORPHAN, LIVE)).toBe(false)

      // Token: tok_orphan_inviter should be gone, tok_live_inviter should remain
      const liveToken = yield* store.claimToken("tok_live_inviter", LIVE)
      expect(Option.isSome(liveToken)).toBe(true)
      const orphanToken = yield* store.claimToken("tok_orphan_inviter", LIVE)
      expect(Option.isNone(orphanToken)).toBe(true)
    }),
  )

  it.effect("is a no-op when there are no orphans", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service
      // Should not throw — just a no-op
      yield* store.deleteOrphaned()
    }),
  )
})
