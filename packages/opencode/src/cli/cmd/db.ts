import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"

type DbShape = Database.Interface["db"]

const TABLES = [
  "session",
  "message",
  "part",
  "event",
  "event_sequence",
  "session_message",
  "session_input",
  "session_context_epoch",
  "todo",
  "credential",
  "permission",
  "project",
  "project_directory",
  "workspace",
  "account",
  "account_state",
  "control_account",
  "session_share",
  "data_migration",
] as const

export function dbStats(db: DbShape) {
  return Effect.gen(function* () {
    const pageCount = yield* db.get<{ page_count: number }>(sql`PRAGMA page_count`).pipe(Effect.orDie)
    const pageSize = yield* db.get<{ page_size: number }>(sql`PRAGMA page_size`).pipe(Effect.orDie)
    const freelist = yield* db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`).pipe(Effect.orDie)

    const counts: Record<string, number> = {}
    for (const table of TABLES) {
      const exists = yield* db
        .get<{ c: number }>(
          sql`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name=${table}`,
        )
        .pipe(Effect.orDie)
      if (!exists?.c) {
        counts[table] = 0
        continue
      }
      const row = yield* db.get<{ c: number }>(sql`SELECT COUNT(*) as c FROM ${sql.identifier(table)}`).pipe(Effect.orDie)
      counts[table] = row?.c ?? 0
    }

    const sizeBytes = (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0)

    return {
      pageCount: pageCount?.page_count ?? 0,
      pageSize: pageSize?.page_size ?? 0,
      freelistCount: freelist?.freelist_count ?? 0,
      sizeBytes,
      sizeMB: Math.round((sizeBytes / 1024 / 1024) * 100) / 100,
      tables: counts,
    }
  })
}

export function pruneOrphanedEvents(db: DbShape) {
  return Effect.gen(function* () {
    yield* db.run(sql`
      DELETE FROM event
      WHERE aggregate_id IN (
        SELECT es.aggregate_id
        FROM event_sequence es
        LEFT JOIN session s ON s.id = es.aggregate_id
        WHERE s.id IS NULL
      )
    `)

    const eventsDeleted = (yield* db.get<{ c: number }>(sql`SELECT changes() as c`))?.c ?? 0

    yield* db.run(sql`
      DELETE FROM event_sequence
      WHERE aggregate_id IN (
        SELECT es.aggregate_id
        FROM event_sequence es
        LEFT JOIN session s ON s.id = es.aggregate_id
        WHERE s.id IS NULL
      )
    `)

    const sequencesDeleted = (yield* db.get<{ c: number }>(sql`SELECT changes() as c`))?.c ?? 0

    return { eventsDeleted, sequencesDeleted }
  }).pipe(Effect.orDie)
}

const QueryCommand = effectCmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: Effect.fn("Cli.db.query")(function* (args: { query?: string; format: string }) {
    const query = args.query as string | undefined
    if (query) {
      const { db } = yield* Database.Service
      const result = yield* db.all<Record<string, unknown>>(sql.raw(query)).pipe(Effect.orDie)
      if (args.format === "json") console.log(JSON.stringify(result, null, 2))
      else if (result.length > 0) {
        const keys = Object.keys(result[0])
        console.log(keys.join("\t"))
        for (const row of result) console.log(keys.map((key) => row[key]).join("\t"))
      }
      return
    }
    const child = spawn("sqlite3", [Database.path()], {
      stdio: "inherit",
    })
    yield* Effect.promise(() => new Promise((resolve) => child.on("close", resolve)))
  }),
})

const PathCommand = effectCmd({
  command: "path",
  describe: "print the database path",
  instance: false,
  handler: Effect.fn("Cli.db.path")(function* () {
    console.log(Database.path())
  }),
})

const StatsCommand = effectCmd({
  command: "stats",
  describe: "show database statistics",
  instance: false,
  handler: Effect.fn("Cli.db.stats")(function* () {
    const { db } = yield* Database.Service
    const stats = yield* dbStats(db)

    console.log(`Database: ${Database.path()}`)
    console.log(`Size: ${stats.sizeMB} MB (${stats.pageCount} pages × ${stats.pageSize} bytes)`)
    console.log(`Freelist: ${stats.freelistCount} pages (${Math.round((stats.freelistCount * stats.pageSize / 1024 / 1024) * 100) / 100} MB reclaimable)`)
    console.log("")
    console.log("Table row counts:")
    for (const [table, count] of Object.entries(stats.tables)) {
      if (count > 0) console.log(`  ${table.padEnd(24)} ${count.toLocaleString()}`)
    }

    if (stats.sizeMB > 1000) {
      console.log("")
      console.log(`\x1b[33m\u26a0  Database exceeds 1 GB. Consider running 'opencode db prune' to reclaim space.\x1b[0m`)
    }
  }),
})

const PruneCommand = effectCmd({
  command: "prune",
  describe: "remove orphaned event data and reclaim space",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "Show what would be deleted without deleting",
      })
      .option("vacuum", {
        type: "boolean",
        default: false,
        describe: "Run VACUUM after pruning to reclaim disk space",
      })
  },
  handler: Effect.fn("Cli.db.prune")(function* (args: { "dry-run": boolean; vacuum: boolean }) {
    const { db } = yield* Database.Service

    const orphanedEvents = yield* db
      .all<{ aggregate_id: string; c: number }>(sql`
        SELECT es.aggregate_id, COUNT(*) as c
        FROM event_sequence es
        LEFT JOIN session s ON s.id = es.aggregate_id
        WHERE s.id IS NULL
        GROUP BY es.aggregate_id
      `)
      .pipe(Effect.orDie)

    const totalOrphaned = orphanedEvents.reduce((sum: number, r) => sum + r.c, 0)

    if (orphanedEvents.length === 0) {
      console.log("No orphaned events found.")
      return
    }

    console.log(`Found ${totalOrphaned.toLocaleString()} orphaned event rows across ${orphanedEvents.length} session(s).`)

    if (args["dry-run"]) {
      console.log("\n--dry-run: no data was modified.")
      return
    }

    const result = yield* pruneOrphanedEvents(db)
    console.log(`Deleted ${result.eventsDeleted.toLocaleString()} event rows, ${result.sequencesDeleted} sequence rows.`)

    if (args.vacuum) {
      console.log("Running VACUUM...")
      yield* db.run(sql`VACUUM`).pipe(Effect.orDie)
      console.log("VACUUM complete.")
    }
  }),
})

const VacuumCommand = effectCmd({
  command: "vacuum",
  describe: "reclaim free space from the database file",
  instance: false,
  handler: Effect.fn("Cli.db.vacuum")(function* () {
    const { db } = yield* Database.Service

    const before = yield* db.get<{ page_count: number; freelist_count: number }>(sql`
      SELECT page_count, (SELECT freelist_count FROM pragma_freelist_count) as freelist_count
    `).pipe(Effect.orDie)

    const beforePages = before?.page_count ?? 0
    const beforeFree = before?.freelist_count ?? 0
    console.log(`Before: ${beforePages} pages, ${beforeFree} free`)
    console.log("Running VACUUM...")

    yield* db.run(sql`VACUUM`).pipe(Effect.orDie)

    const after = yield* db.get<{ page_count: number; freelist_count: number }>(sql`
      SELECT page_count, (SELECT freelist_count FROM pragma_freelist_count) as freelist_count
    `).pipe(Effect.orDie)

    const afterPages = after?.page_count ?? 0
    const pageSize = (yield* db.get<{ page_size: number }>(sql`PRAGMA page_size`).pipe(Effect.orDie))?.page_size ?? 4096
    const reclaimedMB = Math.round(((beforePages - afterPages) * pageSize / 1024 / 1024) * 100) / 100
    console.log(`After: ${afterPages} pages, ${after?.freelist_count ?? 0} free`)
    console.log(`Reclaimed: ${reclaimedMB} MB`)
  }),
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(StatsCommand).command(PruneCommand).command(VacuumCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
