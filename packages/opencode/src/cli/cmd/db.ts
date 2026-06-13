import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { runDoctorCommand, runRepairCommand } from "./db-runner"

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

const DoctorCommand = cmd({
  command: "doctor",
  describe: "diagnose database health issues",
  builder: (yargs: Argv) => {
    return yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Output in JSON format",
    })
  },
  handler: async (args: { json: boolean }) => {
    process.exitCode = (await runDoctorCommand(Database.path(), args)).exitCode
  },
})

const RepairCommand = cmd({
  command: "repair",
  describe: "plan or apply database repairs",
  builder: (yargs: Argv) => {
    return yargs
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "Generate repair plan without applying",
      })
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "Apply repairs (creates backup first)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output in JSON format",
      })
      .check((argv) => {
        if (argv.dryRun && argv.apply) {
          throw new Error("Cannot use both --dry-run and --apply")
        }
        if (!argv.dryRun && !argv.apply) {
          throw new Error("Must specify either --dry-run or --apply")
        }
        return true
      })
  },
  handler: async (args: {
    dryRun?: boolean
    "dry-run"?: boolean
    apply: boolean
    json: boolean
  }) => {
    process.exitCode = (await runRepairCommand(Database.path(), args)).exitCode
  },
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(DoctorCommand).command(RepairCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
