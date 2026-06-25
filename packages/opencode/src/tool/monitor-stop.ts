import * as Tool from "./tool"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Effect, Schema } from "effect"
import { TYPE } from "./monitor"

const id = "monitor_stop"

export const Parameters = Schema.Struct({
  id: Schema.optional(
    Schema.String.annotate({
      description: "The monitor id returned when it was armed (e.g. job_...). Stops exactly that monitor.",
    }),
  ),
  description: Schema.optional(
    Schema.String.annotate({
      description:
        "Alternatively, the exact description the monitor was armed with. Stops every running monitor with " +
        "that description in this session. Use this when you don't have the id handy.",
    }),
  ),
})

export const MonitorStopTool = Tool.define(
  id,
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("MonitorStopTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (!flags.experimentalMonitor) {
        return yield* Effect.die(new Error("monitor_stop tool requires OPENCODE_EXPERIMENTAL_MONITOR=true"))
      }

      if (!params.id && !params.description) {
        return {
          title: "monitor_stop",
          metadata: { stopped: false, count: 0, ids: [] as string[] },
          output: "Provide either the monitor id or its exact description to stop a monitor.",
        }
      }

      // Only ever stop RUNNING monitors armed in THIS session — never another tool's job
      // (bash_background) and never a monitor in a different session.
      const running = (yield* jobs.list()).filter(
        (j) => j.type === TYPE && j.status === "running" && j.metadata?.["sessionId"] === ctx.sessionID,
      )
      const targets = params.id
        ? running.filter((j) => j.id === params.id)
        : running.filter((j) => j.metadata?.["description"] === params.description)

      if (targets.length === 0) {
        const ref = params.id ? `id "${params.id}"` : `description "${params.description}"`
        return {
          title: params.id ?? params.description ?? "monitor_stop",
          metadata: { stopped: false, count: 0, ids: [] as string[] },
          output: `No active monitor matching ${ref} in this session.`,
        }
      }

      yield* Effect.forEach(targets, (j) => jobs.cancel(j.id), { concurrency: "unbounded", discard: true })

      const labels = targets.map((j) => (j.metadata?.["description"] as string | undefined) ?? j.id)
      return {
        title: labels[0] ?? "monitor_stop",
        metadata: { stopped: true, count: targets.length, ids: targets.map((j) => j.id) as string[] },
        output:
          targets.length === 1
            ? `Stopped monitor ${targets[0]!.id} ("${labels[0]}").`
            : `Stopped ${targets.length} monitors: ${labels.map((l) => `"${l}"`).join(", ")}.`,
      }
    })

    return {
      parameters: Parameters,
      description:
        "Stop a running monitor by its id (returned when armed) or by its exact description. " +
        "Use this to retire a watch you no longer need — e.g. one armed with a wrong path, or a duplicate " +
        "created because a corrected re-arm used a different description.",
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
