import { EOL } from "os"
import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"
import { writeStdout } from "../../util/stdout"

// Matches the 64 KiB pipe buffer: large enough that a flush rarely blocks, small
// enough that the rendered text never becomes a second copy of the result set.
const CHUNK_SIZE = 64 * 1024

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
      if (args.format === "json") {
        yield* Effect.promise(() => writeStdout(JSON.stringify(result, null, 2) + EOL))
      } else if (result.length > 0) {
        const keys = Object.keys(result[0])
        // Flush in chunks rather than joining the whole table first: `db.all()`
        // has already materialized every row, so buffering the rendered text on
        // top of that doubles the footprint on large results.
        let chunk = keys.join("\t") + EOL
        for (const row of result) {
          chunk += keys.map((key) => row[key]).join("\t") + EOL
          if (chunk.length >= CHUNK_SIZE) {
            const pending = chunk
            chunk = ""
            yield* Effect.promise(() => writeStdout(pending))
          }
        }
        if (chunk.length > 0) yield* Effect.promise(() => writeStdout(chunk))
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

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
