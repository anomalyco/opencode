import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd, fail } from "../effect-cmd"
import { RuntimeFlags } from "@/effect/runtime-flags"

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

const CompactCommand = effectCmd({
  command: "compact",
  describe:
    "delete duplicate snapshot events from the event log (local use only; incompatible with experimental workspaces sync)",
  instance: false,
  handler: Effect.fn("Cli.db.compact")(function* () {
    const flags = yield* RuntimeFlags.Service
    if (flags.experimentalWorkspaces) {
      return yield* fail(
        "db compact is not available while OPENCODE_EXPERIMENTAL_WORKSPACES is enabled: it leaves sequence gaps that break cross-instance sync history.",
      )
    }
    const { db } = yield* Database.Service
    const EventV2 = yield* Effect.promise(() => import("@opencode-ai/core/event"))
    const result = yield* EventV2.compactSnapshotEvents(db)
    console.log(
      `Removed ${result.removed} redundant snapshot events (${(result.bytes / 1024 / 1024).toFixed(1)} MiB of JSON payload).`,
    )
    const sizeBefore = (yield* db.all(sql.raw(`PRAGMA page_count;`)).pipe(Effect.orDie)) as Array<{ page_count: number }>
    yield* db.run(sql.raw(`VACUUM;`)).pipe(Effect.orDie)
    const sizeAfter = (yield* db.all(sql.raw(`PRAGMA page_count;`)).pipe(Effect.orDie)) as Array<{ page_count: number }>
    if (sizeBefore.length > 0 && sizeAfter.length > 0) {
      const pagesBefore = Number(sizeBefore[0]?.page_count)
      const pagesAfter = Number(sizeAfter[0]?.page_count)
      console.log(
        `DB pages: ${pagesBefore.toLocaleString()} -> ${pagesAfter.toLocaleString()} (-${(100 * (1 - pagesAfter / Math.max(pagesBefore, 1))).toFixed(1)}%)`,
      )
    }
  }),
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(CompactCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
