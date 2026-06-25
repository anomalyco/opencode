import * as Tool from "./tool"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Clock, Effect, Schema } from "effect"
import { TYPE } from "./monitor"

const id = "monitor_list"

export const Parameters = Schema.Struct({})

const fmtAge = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

export const MonitorListTool = Tool.define(
  id,
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("MonitorListTool.execute")(function* (
      _params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (!flags.experimentalMonitor) {
        return yield* Effect.die(new Error("monitor_list tool requires OPENCODE_EXPERIMENTAL_MONITOR=true"))
      }

      const now = yield* Clock.currentTimeMillis
      // Running monitors armed in THIS session, oldest first.
      const running = (yield* jobs.list())
        .filter((j) => j.type === TYPE && j.status === "running" && j.metadata?.["sessionId"] === ctx.sessionID)
        .toSorted((a, b) => a.started_at - b.started_at)

      const rows = running.map((j) => ({
        id: j.id,
        description: (j.metadata?.["description"] as string | undefined) ?? j.title ?? "",
        ageMs: now - j.started_at,
      }))

      if (rows.length === 0) {
        return {
          title: "monitor_list",
          metadata: { count: 0, monitors: rows },
          output: "No active monitors in this session.",
        }
      }

      const lines = rows.map((r) => `- ${r.id} "${r.description}" — running ${fmtAge(r.ageMs)}`)
      return {
        title: `${rows.length} active monitor${rows.length === 1 ? "" : "s"}`,
        metadata: { count: rows.length, monitors: rows },
        output:
          `Active monitors in this session (${rows.length}). Stop any with monitor_stop ` +
          `(by id or description):\n${lines.join("\n")}`,
      }
    })

    return {
      parameters: Parameters,
      description:
        "List the monitors currently running in this session, with their id, description, and how long they've " +
        "been running (oldest first). Use this to see what's active before stopping one with monitor_stop — " +
        "e.g. to find a stale or duplicate watch whose id you didn't keep.",
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
