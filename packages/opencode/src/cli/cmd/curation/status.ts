import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { Database } from "@opencode-ai/core/database/database"
import { curationLogTable } from "@/self-improvement/curation-log.sql"
import { desc } from "drizzle-orm"

export const CurationStatusCommand = effectCmd({
  command: "status",
  describe: "show curation cycle status and recent history",
  builder: (yargs) =>
    yargs.option("limit", {
      describe: "number of recent runs to show",
      type: "number",
      default: 5,
    }),
  handler: Effect.fn("Cli.CurationStatus")(function* (args) {
    const { db } = yield* Database.Service
    const runs = db.select().from(curationLogTable).orderBy(desc(curationLogTable.time_started)).limit(args.limit).all()

    if (runs.length === 0) {
      return yield* fail("No curation runs recorded yet. Run `opencode curation run` to start one.")
    }

    console.log("Curation Run History" + EOL)

    for (const run of runs) {
      const startTime = new Date(Number(run.time_started)).toLocaleString()
      const endTime = run.time_completed
        ? new Date(Number(run.time_completed)).toLocaleString()
        : "in progress"
      const statusLabel =
        run.status === "completed"
          ? "\x1b[32mcompleted\x1b[0m"
          : run.status === "failed"
            ? "\x1b[31mfailed\x1b[0m"
            : "\x1b[33mrunning\x1b[0m"

      console.log(`  [${run.id.slice(0, 8)}] ${statusLabel}  type=${run.type}  affected=${run.memories_affected}`)
      console.log(`         ${startTime} \u2192 ${endTime}`)

      let stats: Record<string, unknown> = {}
      try { stats = JSON.parse(run.stats_json) } catch { /* corrupted data — show empty */ }
      if (Object.keys(stats).length > 0) {
        const statParts = Object.entries(stats).map(([k, v]) => `${k}=${v}`)
        console.log(`         stats: ${statParts.join(", ")}`)
      }

      if (run.error) {
        console.log(`         error: ${run.error}`)
      }

      console.log()
    }
  }),
})