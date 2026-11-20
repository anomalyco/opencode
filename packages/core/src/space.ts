export * as Space from "./space.js"

import { and, asc, eq, gt, isNotNull, max, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Space as SpaceSchema } from "@opencode/schema/space"
import type { Database } from "./database/database.js"
import { SpaceTable } from "./space/sql.js"

type Db = Database.Interface["db"]

// One past the space's highest revision, read by the statement that writes the row. SQLite runs one write at a time,
// so revisions follow commit order, and tombstones keep the highest one, so none is reissued after a restart.
const next = (space: SpaceSchema.Name) =>
  sql<SpaceSchema.Revision>`(SELECT coalesce(max(${SpaceTable.revision}), 0) + 1 FROM ${SpaceTable} WHERE ${SpaceTable.space} = ${space})`

/** Stores the value and returns the revision it was given. */
export const set = (db: Db, space: SpaceSchema.Name, key: SpaceSchema.Key, value: SpaceSchema.Value) =>
  db
    .insert(SpaceTable)
    .values({ space, key, value, revision: next(space) })
    .onConflictDoUpdate({
      target: [SpaceTable.space, SpaceTable.key],
      set: { value, revision: sql`excluded.${sql.identifier("revision")}` },
    })
    .returning({ revision: SpaceTable.revision })
    .get()
    .pipe(
      Effect.orDie,
      Effect.flatMap((row) => (row ? Effect.succeed(row.revision) : Effect.die(new Error("Upsert returned no row")))),
    )

/** Turns a stored value into a tombstone; returns its revision, or undefined when no value was stored. */
export const remove = (db: Db, space: SpaceSchema.Name, key: SpaceSchema.Key) =>
  db
    .update(SpaceTable)
    .set({ value: null, revision: next(space) })
    .where(and(eq(SpaceTable.space, space), eq(SpaceTable.key, key), isNotNull(SpaceTable.value)))
    .returning({ revision: SpaceTable.revision })
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.revision),
    )

/** The space's highest revision, 0 before its first write. */
export const head = (db: Db, space: SpaceSchema.Name) =>
  db
    .select({ revision: max(SpaceTable.revision) })
    .from(SpaceTable)
    .where(eq(SpaceTable.space, space))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.revision ?? 0),
    )

/** Rows, tombstones included, written after `since`, in revision order: one range of the revision index. */
export const changes = (db: Db, space: SpaceSchema.Name, since: SpaceSchema.Revision, limit?: number) =>
  db
    .select({ key: SpaceTable.key, value: SpaceTable.value, revision: SpaceTable.revision })
    .from(SpaceTable)
    .where(and(eq(SpaceTable.space, space), gt(SpaceTable.revision, since)))
    .orderBy(asc(SpaceTable.revision))
    .limit(limit ?? -1)
    .all()
    .pipe(Effect.orDie)
