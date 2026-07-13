import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEventLogCompaction } from "@opencode-ai/core/session/event-log-compaction"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"

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

const CompactEventsCommand = effectCmd({
  command: "compact-events",
  describe: "replace superseded message and part snapshots with replay-safe checkpoints",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("apply", { type: "boolean", default: false, describe: "write checkpoints; default is dry-run" })
      .option("session", { type: "string", describe: "compact one session aggregate" })
      .option("limit", { type: "number", describe: "maximum snapshots to compact" }),
  handler: Effect.fn("Cli.db.compactEvents")(function* (args: { apply: boolean; session?: string; limit?: number }) {
    const { db } = yield* Database.Service
    const report = yield* SessionEventLogCompaction.compact(db, {
      aggregateID: args.session,
      dryRun: !args.apply,
      limit: args.limit,
    })
    console.log(JSON.stringify(report, null, 2))
  }),
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(CompactEventsCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
