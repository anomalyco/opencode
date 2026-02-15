import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "../../storage/db"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
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
  handler: async (args: { query?: string; format: string }) => {
    const query = args.query as string | undefined
    if (query) {
      const db = new BunDatabase(Database.Path, { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
      db.close()
      return
    }
    const child = spawn("sqlite3", [Database.Path], {
      stdio: "inherit",
    })
    await new Promise((resolve) => child.on("close", resolve))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.Path)
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).demandCommand()
  },
  handler: () => {},
})
