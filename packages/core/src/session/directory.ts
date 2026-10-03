export * as SessionDirectory from "./directory"

import { and, eq, inArray, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import { FSUtil } from "../fs-util"
import { SessionTable } from "./sql"

const sameSpelling = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

const resolveSafe = (directory: string) =>
  Effect.try({
    try: () => FSUtil.resolve(directory),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined))

export const filter = Effect.fn("SessionDirectory.filter")(function* (
  db: Database.Interface["db"],
  directory: string,
  base: SQL[],
) {
  const stored = yield* db
    .selectDistinct({ directory: SessionTable.directory })
    .from(SessionTable)
    .where(base.length > 0 ? and(...base) : undefined)
    .all()
    .pipe(Effect.orDie)
  const aliases = stored
    .map((row) => row.directory)
    .filter((candidate) => candidate !== directory && sameSpelling(candidate, directory))
  if (aliases.length === 0) return eq(SessionTable.directory, directory)
  // Filesystem identity decides: case variants are the same directory on
  // case-insensitive volumes and distinct directories elsewhere. Missing
  // directories keep exact-spelling history.
  const canonical = yield* resolveSafe(directory)
  if (canonical === undefined) return eq(SessionTable.directory, directory)
  const matched: string[] = []
  for (const candidate of aliases) {
    const resolved = yield* resolveSafe(candidate)
    if (resolved === canonical) matched.push(candidate)
  }
  return inArray(SessionTable.directory, [directory, ...matched])
})
