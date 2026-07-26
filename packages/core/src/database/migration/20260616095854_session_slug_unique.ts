// NOTE (2026-06-16): session.slug is NOT unique and was never designed to be.
// Slug.create() (packages/core/src/util/slug.ts) returns a random adjective-noun
// pair from a small fixed word list, and a new session's slug starts as "" until
// a title is generated — so with enough sessions the slug space saturates and
// new inserts collide. An earlier version of this migration created a
// `session_slug_unique` UNIQUE INDEX, which made Session.createNext throw on
// every new session once the space filled (a real install with ~2800 sessions
// could not create any new session). s2s cross-process addressing was reworked
// to use the globally-unique session_id instead of the slug, so slug uniqueness
// is not needed anywhere.
//
// This migration is now a self-healing no-op: it DROPS the bad index if a DB
// applied the earlier version, and creates nothing. The id is preserved so the
// migration journal stays consistent for DBs that already recorded it.

import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260616095854_session_slug_unique",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS session_slug_unique;`)
    })
  },
} satisfies DatabaseMigration.Migration
