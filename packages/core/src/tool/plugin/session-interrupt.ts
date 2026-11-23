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
    const stop = (sessionID: Session.ID): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* jobs.cancelSession(sessionID)
        yield* sessions.interrupt(sessionID)
        yield* jobs.cancelSession(sessionID)
        const children = yield* sessions.list({ parentID: sessionID, limit: 1000 }).pipe(Effect.orDie)
        yield* Effect.forEach(children.data, (child) => stop(child.id), { discard: true })
      })

    yield* ctx.tool
      .transform((editor) => {
        if (!flags.resolve(loaded.entries).full_codemode.enabled) return
        editor.add({
          name: "interrupt",
          description: "Interrupt a session, and stop its background commands and subagents too.",
          input: Input,
          output: Schema.String,
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
              yield* stop(input.sessionID)
              return { output: `Interrupted session ${input.sessionID}.` }
            }).pipe(Effect.mapError(toolFailure(`Unable to interrupt session ${input.sessionID}`))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
