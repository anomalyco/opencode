import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEventLogCompaction } from "@opencode-ai/core/session/event-log-compaction"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import path from "node:path"
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
    untilDone: boolean
    vacuum: boolean
    backup?: string
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
      .option("afterSeq", { alias: "after-seq", type: "number", describe: "event cursor returned by a bounded batch" })
      .option("untilDone", {
        alias: "until-done",
        type: "boolean",
        default: false,
        describe: "apply batches until all work is complete",
      })
      .option("vacuum", { type: "boolean", default: false, describe: "verify and reclaim physical storage" })
      .option("backup", { type: "string", describe: "absolute path for the verified compact recovery database" }),
  async handler(args) {
    const effect = Database.Service.use(({ db }) =>
      Effect.gen(function* () {
        if (args.untilDone && (!args.apply || !args.all)) {
          return yield* fail("until-done requires --all --apply")
        }
        if (args.vacuum && (!args.untilDone || !args.backup)) {
          return yield* fail("vacuum requires --all --apply --until-done --backup <absolute-path>")
        }
        if (args.backup && !args.vacuum) return yield* fail("backup requires --vacuum")
        if (args.backup && !path.isAbsolute(args.backup)) return yield* fail("backup path must be absolute")
        if (args.backup === Database.path()) return yield* fail("backup path must differ from the source database")

        const run = Effect.gen(function* () {
          let cursor = args.cursor
          let afterSeq = args.afterSeq
          let batches = 0
          let inspected = 0
          let candidates = 0
          let rewritten = 0
          let projectionMismatches = 0
          let compatibilityRejected = 0
          let malformed = 0
          let payloadBytesReclaimed = 0
          const byType: Record<string, { events: number; payloadBytesReclaimed: number }> = {}

          if (args.untilDone) yield* SessionEventLogCompaction.prepareIndex(db)

          while (true) {
            const indexed = args.untilDone ? yield* SessionEventLogCompaction.compactIndexed(db, args.limit) : undefined
            const report = indexed
              ? indexed.report
              : yield* SessionEventLogCompaction.compact(db, {
                  aggregateID: args.session,
                  all: args.all,
                  apply: args.apply,
                  limit: args.limit,
                  cursor,
                  afterSeq,
                })
            if (!args.untilDone) {
              console.log(JSON.stringify(report, null, 2))
              return
            }

            batches++
            inspected += report.inspected
            candidates += report.candidates
            rewritten += report.rewritten
            projectionMismatches += report.projectionMismatches
            compatibilityRejected += report.compatibilityRejected
            if (batches === 1) malformed = report.malformed
            payloadBytesReclaimed += report.payloadBytesReclaimed
            for (const [type, summary] of Object.entries(report.byType)) {
              const current = byType[type] ?? { events: 0, payloadBytesReclaimed: 0 }
              current.events += summary.events
              current.payloadBytesReclaimed += summary.payloadBytesReclaimed
              byType[type] = current
            }
            if (batches % 10 === 0) console.error(`compaction: ${rewritten} events rewritten in ${batches} batches`)
            if (indexed && indexed.cursor === undefined) break
            const next = "next" in report ? report.next : undefined
            if (indexed) continue
            if (!next) break
            cursor = next.cursor
            afterSeq = next.afterSeq
          }

          if (args.untilDone) yield* SessionEventLogCompaction.dropIndex(db)
          const reclaim = args.vacuum ? yield* SessionEventLogCompaction.reclaim(db, args.backup) : undefined
          console.log(
            JSON.stringify(
              {
                dryRun: false,
                batches,
                inspected,
                candidates,
                rewritten,
                projectionMismatches,
                compatibilityRejected,
                malformed,
                payloadBytesReclaimed,
                byType,
                reclaim,
              },
              null,
              2,
            ),
          )
        })

        if (!args.untilDone) return yield* run
        yield* Database.acquireExclusive(db)
        return yield* run
      }).pipe(Effect.catchDefect((error) => fail(error instanceof Error ? error.message : String(error)))),
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
