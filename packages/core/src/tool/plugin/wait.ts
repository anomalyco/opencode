export * as WaitTool from "./wait.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema } from "effect"
import { CodeModeJob } from "../../codemode/job.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Job } from "../../job.js"
import { NonNegativeInt } from "../../schema.js"

export const name = "wait"
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000

const description = [
  "Wait for this session's background scripts and shell commands to finish, and return their results.",
  "With `ids`, it returns once all of them finish; without, once any does.",
  "After `timeout`, it returns what is still running.",
  "A result returned here is not notified again.",
].join(" ")

export const Input = Schema.Struct({
  ids: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "Script (`cm_…`) or shell (`sh_…`) IDs. Defaults to all of this session's background jobs.",
  }),
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Milliseconds to wait (default ${DEFAULT_TIMEOUT_MS})`,
  }),
})

const Result = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["running", "completed", "error", "cancelled", "unknown"]),
  output: Schema.optionalKey(Schema.String),
})

export const Output = Schema.Struct({ jobs: Schema.Array(Result) })

const render = (result: typeof Result.Type) => {
  if (result.status === "running") return `${result.id} is still running.`
  if (result.status === "unknown")
    return `${result.id} is not a background job of this session, or its result was already delivered.`
  return `${result.id} ${result.status}${result.output ? `:\n${result.output}` : "."}`
}

export const Plugin = {
  id: "opencode.tool.wait",
  effect: Effect.fn("WaitTool.Plugin")(function* (ctx: Context) {
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
          // Pinned so a script waits with it instead of polling.
          options: { codemode: { pinned: true } },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
              const extend = yield* CodeModeJob.Extend
              // A script never waits for itself.
              const self = yield* Job.BlockingParent
              const owned = new Set(
                (yield* jobs.backgroundJobs)
                  .filter(
                    (job) =>
                      job.sessionID === context.sessionID &&
                      (job.kind === "codemode" || job.kind === "shell") &&
                      job.id !== self,
                  )
                  .map((job) => job.id),
              )
              const all = input.ids !== undefined && input.ids.length > 0
              const ids = all ? [...new Set(input.ids)] : [...owned]
              const waitable = ids.filter((id) => owned.has(id))
              const waits = waitable.map((id) => jobs.wait({ id }))
              // Finished results are taken, so their notifications are skipped. The calling script keeps blocking
              // while this waits, instead of moving to the background.
              const infos = yield* jobs
                .collect(
                  waitable,
                  waits.length === 0
                    ? Effect.void
                    : (all
                        ? Effect.all(waits, { concurrency: "unbounded", discard: true })
                        : Effect.raceAll(waits)
                      ).pipe(Effect.timeoutOption(Duration.millis(timeout)), Effect.asVoid),
                )
                .pipe(extend(timeout))
              const found = new Map(waitable.map((id, index) => [id, infos[index]]))
              const results = ids.map((id): typeof Result.Type => {
                const info = found.get(id)
                if (!info) return { id, status: "unknown" }
                if (info.status === "running") return { id, status: info.status }
                const output = info.output ?? info.error
                return { id, status: info.status, ...(output !== undefined ? { output } : {}) }
              })
              return {
                output: { jobs: results },
                content: results.length ? results.map(render).join("\n\n") : "No background jobs.",
                metadata: {},
              }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
