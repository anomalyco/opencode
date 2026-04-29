import type { Argv } from "yargs"
import { cmd } from "../cmd"

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
  handler: async (args) => {
    await import("./handler").then(({ queryHandler }) => queryHandler(args))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: async () => {
    await import("./handler").then(({ pathHandler }) => pathHandler())
  },
})

const MigrateCommand = cmd({
  command: "migrate",
  describe: "migrate JSON data to SQLite (merges with existing data)",
  handler: async () => {
    await import("./handler").then(({ migrateHandler }) => migrateHandler())
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(MigrateCommand).demandCommand()
  },
  handler: () => {},
})
