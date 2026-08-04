import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEventLogCompaction } from "@opencode-ai/core/session/event-log-compaction"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd, fail } from "../effect-cmd"
import { cmd } from "./cmd"

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

const CompactEventsCommand = cmd<
  {},
  {
    apply: boolean
    session?: string
    all: boolean
    limit?: number
    cursor?: string
    afterSeq?: number
  }
>({
  command: "compact-events",
  describe: "replace superseded message and part snapshots with replay-safe checkpoints",
  builder: (yargs: Argv) =>
    yargs
      .option("apply", { type: "boolean", default: false, describe: "write checkpoints; default is dry-run" })
      .option("session", { type: "string", describe: "compact one session aggregate" })
      .option("all", { type: "boolean", default: false, describe: "inspect all session aggregates" })
      .option("limit", { type: "number", describe: "maximum snapshots per bounded batch" })
      .option("cursor", { type: "string", describe: "session cursor returned by an all-scope batch" })
      .option("after-seq", { type: "number", describe: "event cursor returned by a bounded batch" }),
  async handler(args) {
    const effect = Database.Service.use(({ db }) =>
      SessionEventLogCompaction.compact(db, {
        aggregateID: args.session,
        all: args.all,
        apply: args.apply,
        limit: args.limit,
        cursor: args.cursor,
        afterSeq: args.afterSeq,
      }).pipe(
        Effect.catchDefect((error) => fail(error instanceof Error ? error.message : String(error))),
        Effect.tap((report) => Effect.sync(() => console.log(JSON.stringify(report, null, 2)))),
      ),
    )
    if (args.apply) {
      const { AppRuntime } = await import("@/effect/app-runtime")
      await AppRuntime.runPromise(effect)
      return
    }
    await Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(Database.readOnlyLayerFromPath(Database.path())))))
  },
})

const EventLogStatusCommand = cmd({
  command: "event-log-status",
  describe: "report event-log growth and compaction recommendation",
  async handler() {
    const effect = Database.Service.use(({ db }) =>
      SessionEventLogCompaction.status(db).pipe(
        Effect.tap((report) => Effect.sync(() => console.log(JSON.stringify(report, null, 2)))),
      ),
    )
    await Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(Database.readOnlyLayerFromPath(Database.path())))))
  },
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .command(QueryCommand)
      .command(PathCommand)
      .command(CompactEventsCommand)
      .command(EventLogStatusCommand)
      .demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
