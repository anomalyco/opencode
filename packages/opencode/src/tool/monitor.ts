import * as Tool from "./tool"
import DESCRIPTION from "./monitor.txt"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Effect, Schema } from "effect"
import { makeShellCommand, runShellJob } from "./background-shell"

const id = "monitor"
const TYPE = "monitor"

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({
    description: "The shell command to run. It must keep running and emit one stdout line per actual event.",
  }),
  description: Schema.String.annotate({
    description: "A short description of what is being watched. Used in event messages.",
  }),
})

type MonitorOps = {
  prompt: (input: {
    sessionID: string
    agent: string
    parts: Array<{ type: "text"; synthetic: boolean; text: string }>
    noReply?: boolean
  }) => Effect.Effect<void>
}

export const MonitorTool = Tool.define(
  id,
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const sessions = yield* Session.Service
    const flags = yield* RuntimeFlags.Service
    const spawner = yield* ChildProcessSpawner

    const run = Effect.fn("MonitorTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (!flags.experimentalMonitor) {
        return yield* Effect.die(new Error("Monitor tool requires OPENCODE_EXPERIMENTAL_MONITOR=true"))
      }

      const ops = (ctx.extra?.promptOps ?? undefined) as MonitorOps | undefined
      if (!ops) {
        return yield* Effect.die(new Error("Monitor tool requires promptOps in ctx.extra"))
      }

      yield* ctx.ask({
        permission: id,
        patterns: [params.command],
        always: ["*"],
        metadata: { description: params.description, command: params.command },
      })

      const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)

      // Re-arming replaces the previous watch — cancel only prior MONITOR jobs
      // for this session (leave any other background jobs running).
      const existing = yield* jobs.list()
      yield* Effect.forEach(
        existing.filter((j) => j.type === TYPE && j.metadata?.["sessionId"] === ctx.sessionID),
        (j) => jobs.cancel(j.id),
        { concurrency: "unbounded", discard: true },
      )

      const command = makeShellCommand(params.command, session.directory)

      // Each stdout line wakes the model; a clean process exit injects one final note.
      const emit = (text: string) =>
        ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: ctx.agent,
            parts: [{ type: "text", synthetic: true, text }],
          })
          .pipe(Effect.ignore)

      const job = runShellJob({
        sessionID: ctx.sessionID,
        command,
        onLine: (line) => emit(`[Monitor: ${params.description}] Event: ${line}`),
      }).pipe(
        Effect.tap((reason) =>
          emit(
            `[Monitor: ${params.description}] Monitor exited (${reason}). If you still need to watch, re-arm with a working command.`,
          ),
        ),
        Effect.provideService(ChildProcessSpawner, spawner),
      )

      const info = yield* jobs.start({
        type: TYPE,
        title: params.description,
        // background:true => "born promoted": the tool returns immediately and
        // nobody awaits the job inline. sessionId drives session-teardown cleanup.
        metadata: { background: true, sessionId: ctx.sessionID, description: params.description },
        run: job,
      })

      return {
        title: params.description,
        metadata: { monitor: true, monitorId: info.id, description: params.description },
        output: `Monitor armed (${info.id}) for "${params.description}". Events will arrive as new messages. Do not re-arm it unless you need a different watch.`,
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
