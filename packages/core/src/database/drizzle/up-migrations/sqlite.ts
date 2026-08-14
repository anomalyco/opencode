/* oxlint-disable */
import type { MigrationMeta } from "drizzle-orm/migrator"
import { type SQL, sql } from "drizzle-orm/sql/sql"

/** @internal */
export type SQLiteMigrationTableRow = { id: number | null; hash: string; created_at: number }

type SQLiteMigrationBackfillEntry = {
  name: string
  selector:
    | { column: "id"; value: number }
    | { column: "created_at"; value: number }
    | { column: "hash"; value: string }
}

function unmatchedMigrationError(unmatched: SQLiteMigrationTableRow[]) {
  return new Error(
    `While upgrading your database migrations table we found ${unmatched.length} (${unmatched
      .map((it) => `[id: ${it.id}, created_at: ${it.created_at}]`)
      .join(
        ", ",
      )}) migrations in the database that do not match any local migration. This means that some migrations were applied to the database but are missing from the local environment`,
  )
}

/** @internal */
export function prepareSQLiteMigrationBackfill(
  dbRows: SQLiteMigrationTableRow[],
  localMigrations: MigrationMeta[],
): SQLiteMigrationBackfillEntry[] {
  const sortedLocalMigrations = [...localMigrations].sort((a, b) =>
    a.folderMillis !== b.folderMillis ? a.folderMillis - b.folderMillis : (a.name ?? "").localeCompare(b.name ?? ""),
  )
  const byMillis = new Map<number, MigrationMeta[]>()
  const byHash = new Map<string, MigrationMeta>()
  for (const migration of sortedLocalMigrations) {
    if (!byMillis.has(migration.folderMillis)) {
      byMillis.set(migration.folderMillis, [])
    }
    byMillis.get(migration.folderMillis)!.push(migration)
    byHash.set(migration.hash, migration)
  }

  const toApply: SQLiteMigrationBackfillEntry[] = []
  const unmatched: SQLiteMigrationTableRow[] = []

  for (const dbRow of dbRows) {
    const stringified = String(dbRow.created_at)
    const millis = Number(stringified.substring(0, stringified.length - 3) + "000")
    const candidates = byMillis.get(millis)

    const matchedByMillis = candidates?.length === 1 ? candidates[0] : undefined
    const matchedByCandidateHash =
      candidates && candidates.length > 1
        ? candidates.find((candidate) => candidate.hash && dbRow.hash && candidate.hash === dbRow.hash)
        : undefined
    const matchedByHash = matchedByMillis || matchedByCandidateHash ? undefined : byHash.get(dbRow.hash)
    const matched = matchedByMillis ?? matchedByCandidateHash ?? matchedByHash

    if (matched) {
      toApply.push({
        name: matched.name,
        selector:
          dbRow.id !== null
            ? { column: "id", value: dbRow.id }
            : matchedByMillis
              ? { column: "created_at", value: dbRow.created_at }
              : { column: "hash", value: dbRow.hash },
      })
      continue
    }

    unmatched.push(dbRow)
  }

  if (unmatched.length > 0) {
    throw unmatchedMigrationError(unmatched)
  }

  return toApply
}

/** @internal */
export function buildSQLiteMigrationBackfillStatements(
  migrationsTable: string,
  backfillEntries: SQLiteMigrationBackfillEntry[],
) {
  const table = sql`${sql.identifier(migrationsTable)}`
  const statements: SQL[] = [
    sql`ALTER TABLE ${table} ADD COLUMN ${sql.identifier("name")} text`,
    sql`ALTER TABLE ${table} ADD COLUMN ${sql.identifier("applied_at")} TEXT`,
  ]

  for (const backfillEntry of backfillEntries) {
    const updateQuery = sql`UPDATE ${table} SET ${sql.identifier("name")} = ${backfillEntry.name}, ${sql.identifier(
      "applied_at",
    )} = NULL WHERE`

    updateQuery.append(sql` ${sql.identifier(backfillEntry.selector.column)} = ${backfillEntry.selector.value}`)

    statements.push(updateQuery)
  }

  return statements
}
