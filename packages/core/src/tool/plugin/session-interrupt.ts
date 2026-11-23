export * as SessionInterruptTool from "./session-interrupt.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"
import { toolFailure } from "../runtime.js"

export const Input = Schema.Struct({
  sessionID: Session.ID.annotate({ description: "The session to interrupt." }),
})

const Output = Schema.Struct({
  sessionID: Session.ID,
  interrupted: Schema.Number.annotate({ description: "Sessions that were running, counting its subagents" }),
  jobs: Schema.Number.annotate({ description: "Background commands, subagents and other jobs cancelled" }),
})

export const Plugin = {
  id: "opencode.tool.session-interrupt",
  effect: Effect.fn("SessionInterruptTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service

    // Cancelled jobs send no completion notice, so nothing wakes these sessions again. They're cancelled before the
    // interrupt, so none finishes in between, and after it, for any the last step started.
    const stop = (sessionID: Session.ID): Effect.Effect<{ interrupted: number; jobs: number }> =>
      Effect.gen(function* () {
        const before = yield* jobs.cancelSession(sessionID)
        const interrupted = yield* sessions.interrupt(sessionID)
        const after = yield* jobs.cancelSession(sessionID)
        const children = yield* sessions.list({ parentID: sessionID, limit: 1000 }).pipe(Effect.orDie)
        const below = yield* Effect.forEach(children.data, (child) => stop(child.id))
        return {
          interrupted: below.reduce((total, item) => total + item.interrupted, interrupted ? 1 : 0),
          jobs: below.reduce((total, item) => total + item.jobs, before.length + after.length),
        }
      })

    yield* ctx.tool
      .transform((editor) => {
        if (!flags.resolve(loaded.entries).full_codemode.enabled) return
        editor.add({
          name: "interrupt",
          description: "Interrupt a session, and stop its background commands and subagents too.",
          input: Input,
          output: Output,
          options: { namespace: "opencode.session", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* sessions.get(input.sessionID)
              // Interrupting the caller or a session above it would stop this call and the caller's own work.
              let id: Session.ID | undefined = context.sessionID
              while (id) {
                if (id === input.sessionID)
                  return yield* new ToolFailure({ message: "A session can't interrupt itself or a session above it" })
                id = (yield* sessions.get(id)).parentID
              }
              const result = yield* stop(input.sessionID)
              return {
                output: { sessionID: input.sessionID, ...result },
                content: `Interrupted session ${input.sessionID}: ${result.interrupted} running, ${result.jobs} jobs cancelled.`,
              }
            }).pipe(Effect.mapError(toolFailure(`Unable to interrupt session ${input.sessionID}`))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
