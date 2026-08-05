import { Clock, Effect, Schema } from "effect"
import * as Tool from "./tool"
import { BackgroundJob } from "@/background/job"
import { renderOutput } from "./task"
import type { SessionID } from "../session/schema"

/** Jobs already handed back by next_agent. Process-local, matching the registry. */
const drained = new Set<string>()

const NEXT_AGENT_DESCRIPTION = [
  "Block until the next background subagent of this session finishes, then return its result.",
  "Use it to collect the result of a task launched with background=true instead of re-asking it for status.",
  "Each result is returned exactly once; a later call hands back the next pending result.",
  "If nothing has finished yet it waits (honoring timeoutSeconds) for the first running task to finish.",
].join(" ")

const AGENTS_STATUS_DESCRIPTION = [
  "Non-blocking snapshot of the background subagents of this session: id, status, elapsed time, and a preview when finished.",
  "Use it to check progress instead of sleeping, polling, or re-asking a running task for status.",
].join(" ")

export const Parameters = Schema.Struct({
  timeoutSeconds: Schema.optional(Schema.Number).annotate({
    description:
      "Maximum seconds to wait for a running background task to finish before returning. Omit to wait indefinitely.",
  }),
})

const NoParameters = Schema.Struct({})

function own(job: BackgroundJob.Info, sessionID: SessionID) {
  return job.metadata?.background === true && job.metadata?.parentSessionId === sessionID
}

function elapsed(ms: number) {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function preview(text: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat
}

function title(job: BackgroundJob.Info) {
  return job.title ? `Background task ${job.status}: ${job.title}` : `Background task ${job.status}`
}

function render(job: BackgroundJob.Info) {
  return renderOutput({
    sessionID: job.id,
    state: job.status,
    summary: title(job),
    text: job.status === "error" ? (job.error ?? "") : (job.output ?? ""),
  })
}

export const NextAgentTool = Tool.define(
  "next_agent",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service

    const run = Effect.fn("NextAgentTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const jobs = (yield* background.list()).filter((job) => own(job, ctx.sessionID))
      const pending = jobs.filter((job) => !drained.has(job.id))
      const terminal = pending.filter((job) => job.status !== "running")
      if (terminal.length > 0) {
        const job = terminal[0]
        drained.add(job.id)
        return { title: title(job), metadata: {}, output: render(job) }
      }
      const running = pending.filter((job) => job.status === "running")
      if (running.length > 0) {
        const waited = yield* Effect.raceAll(
          running.map((job) =>
            background.wait({
              id: job.id,
              ...(params.timeoutSeconds !== undefined ? { timeout: params.timeoutSeconds * 1000 } : {}),
            }),
          ),
        )
        if (waited.timedOut) {
          return {
            title: "Background tasks still running",
            metadata: {},
            output: `Timed out waiting for background tasks to finish; ${running.length} still running.`,
          }
        }
        const job = waited.info
        if (!job) {
          return { title: "No background tasks", metadata: {}, output: "no background tasks" }
        }
        drained.add(job.id)
        return { title: title(job), metadata: {}, output: render(job) }
      }
      return { title: "No background tasks", metadata: {}, output: "no background tasks" }
    })

    return {
      description: NEXT_AGENT_DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

export const AgentsStatusTool = Tool.define(
  "agents_status",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service

    const run = Effect.fn("AgentsStatusTool.execute")(function* (
      _params: Schema.Schema.Type<typeof NoParameters>,
      ctx: Tool.Context,
    ) {
      const jobs = (yield* background.list()).filter((job) => own(job, ctx.sessionID))
      if (jobs.length === 0) {
        return {
          title: "No background tasks",
          metadata: {},
          output: "No background tasks running for this session.",
        }
      }
      const now = yield* Clock.currentTimeMillis
      const lines = jobs.map((job) => {
        const consumed = drained.has(job.id) ? " (drained)" : ""
        const time = elapsed(now - job.started_at)
        const head = `- ${job.id} [${job.status}]${consumed}${job.title ? ` ${job.title}` : ""} ${time}`
        const tail =
          job.status === "running" ? "" : `\n  ${preview(job.status === "error" ? (job.error ?? "") : (job.output ?? ""))}`
        return head + tail
      })
      return { title: `Background tasks (${jobs.length})`, metadata: {}, output: lines.join("\n") }
    })

    return {
      description: AGENTS_STATUS_DESCRIPTION,
      parameters: NoParameters,
      execute: (params: Schema.Schema.Type<typeof NoParameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
