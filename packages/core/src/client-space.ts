export * as ClientSpace from "./client-space.js"

import { and, asc, eq, gt, isNotNull, max, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { ClientKV } from "@opencode/schema/client-kv"
import type { Database } from "./database/database.js"
import { ClientSpaceTable } from "./client-space/sql.js"

type Db = Database.Interface["db"]

// One past the space's highest revision, read by the statement that writes the row. SQLite runs one write at a time,
// so revisions follow commit order, and tombstones keep the highest one, so none is reissued after a restart.
const next = (space: ClientKV.Space) =>
  sql<ClientKV.Revision>`(SELECT coalesce(max(${ClientSpaceTable.revision}), 0) + 1 FROM ${ClientSpaceTable} WHERE ${ClientSpaceTable.space} = ${space})`

/** Stores the value and returns the revision it was given. */
export const set = (db: Db, space: ClientKV.Space, key: ClientKV.Key, value: ClientKV.Value) =>
  db
    .insert(ClientSpaceTable)
    .values({ space, key, value, revision: next(space) })
    .onConflictDoUpdate({
      target: [ClientSpaceTable.space, ClientSpaceTable.key],
      set: { value, revision: sql`excluded.${sql.identifier("revision")}` },
    })
    .returning({ revision: ClientSpaceTable.revision })
    .get()
    .pipe(
      Effect.orDie,
      Effect.flatMap((row) => (row ? Effect.succeed(row.revision) : Effect.die(new Error("Upsert returned no row")))),
    )

/** Turns a stored value into a tombstone; returns its revision, or undefined when no value was stored. */
export const remove = (db: Db, space: ClientKV.Space, key: ClientKV.Key) =>
  db
    .update(ClientSpaceTable)
    .set({ value: null, revision: next(space) })
    .where(and(eq(ClientSpaceTable.space, space), eq(ClientSpaceTable.key, key), isNotNull(ClientSpaceTable.value)))
    .returning({ revision: ClientSpaceTable.revision })
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.revision),
    )

/** The space's highest revision, 0 before its first write. */
export const head = (db: Db, space: ClientKV.Space) =>
  db
    .select({ revision: max(ClientSpaceTable.revision) })
    .from(ClientSpaceTable)
    .where(eq(ClientSpaceTable.space, space))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.revision ?? 0),
    )

/** Every row, tombstones included, written after `since`, in revision order: one range of the revision index. */
export const changes = (db: Db, space: ClientKV.Space, since: ClientKV.Revision) =>
  db
    .select({ key: ClientSpaceTable.key, value: ClientSpaceTable.value, revision: ClientSpaceTable.revision })
    .from(ClientSpaceTable)
    .where(and(eq(ClientSpaceTable.space, space), gt(ClientSpaceTable.revision, since)))
    .orderBy(asc(ClientSpaceTable.revision))
    .all()
    .pipe(Effect.orDie)
