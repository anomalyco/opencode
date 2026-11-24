export * as StopTool from "./stop.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Job } from "../../job.js"

export const name = "stop"

const description = [
  "Stop this session's background scripts (`cm_…`) and shell commands (`sh_…`), such as a yielded shell's `shellID`.",
  "Nothing is reported for what it stops.",
].join(" ")

export const Input = Schema.Struct({
  ids: Schema.Array(Schema.String).annotate({ description: "Script or shell IDs to stop" }),
})

export const Output = Schema.Struct({
  stopped: Schema.Array(Schema.String),
  notRunning: Schema.Array(Schema.String).annotate({
    description: "IDs that are not running background work of this session, e.g. because they already finished",
  }),
})

export const Plugin = {
  id: "opencode.tool.stop",
  effect: Effect.fn("StopTool.Plugin")(function* (ctx: Context) {
    const jobs = yield* Job.Service
    const config = yield* Config.Service
    // Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service

    yield* ctx.tool
      .transform((editor) => {
        if (!flags.resolve(loaded.entries).full_codemode.enabled) return
        editor.add({
          name,
          options: { codemode: { pinned: true } },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              // A script never stops itself.
              const self = yield* Job.BlockingParent
              const running = new Set(
                (yield* jobs.backgroundJobs)
                  .filter(
                    (job) =>
                      job.sessionID === context.sessionID &&
                      (job.kind === "codemode" || job.kind === "shell") &&
                      job.status === "running" &&
                      job.id !== self,
                  )
                  .map((job) => job.id),
              )
              const ids = [...new Set(input.ids)]
              const stopped = ids.filter((id) => running.has(id))
              yield* Effect.forEach(
                stopped,
                Effect.fnUntraced(function* (id) {
                  // The model asked for this, so no notification follows: the cancel's result is taken. This doesn't
                  // wait for other holds, such as a `shell_read` waiting on the same shell, which the cancel ends.
                  const [info] = yield* jobs.collect([id], jobs.cancel(id).pipe(Effect.asVoid))
                  if (info?.notificationID) yield* jobs.completeBackground(info.notificationID)
                }),
                { discard: true },
              )
              const notRunning = ids.filter((id) => !running.has(id))
              const text = [
                ...(stopped.length ? [`Stopped ${stopped.join(", ")}.`] : []),
                ...(notRunning.length
                  ? [`Not running background work of this session: ${notRunning.join(", ")}.`]
                  : []),
              ].join("\n")
              return { output: { stopped, notRunning }, content: text || "Nothing to stop.", metadata: {} }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
