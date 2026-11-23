export * as SessionInterruptTool from "./session-interrupt.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"

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

    // Every page of a session's direct children.
    const children = (
      input: { readonly parentID: Session.ID; readonly limit: number } | { readonly cursor: Session.ListCursor },
    ): Effect.Effect<Session.Info[]> =>
      sessions.list(input).pipe(
        Effect.orDie,
        Effect.flatMap((page) =>
          page.data.length === 0 || !page.cursor.next
            ? Effect.succeed(page.data)
            : children({ cursor: page.cursor.next }).pipe(Effect.map((rest) => [...page.data, ...rest])),
        ),
      )

    const isSelfOrAncestor = (target: Session.ID, sessionID: Session.ID | undefined): Effect.Effect<boolean> =>
      sessionID === undefined
        ? Effect.succeed(false)
        : sessionID === target
          ? Effect.succeed(true)
          : sessions.get(sessionID).pipe(
              Effect.map((session) => session.parentID),
              Effect.orElseSucceed(() => undefined),
              Effect.flatMap((parentID) => isSelfOrAncestor(target, parentID)),
            )

    // Cancelled jobs send no completion notice, so nothing wakes an interrupted session again. Jobs are cancelled
    // before the interrupt, so none finishes and wakes it meanwhile, and again after, for any its last step started.
    const stop = (sessionID: Session.ID): Effect.Effect<{ interrupted: number; jobs: number }> =>
      Effect.gen(function* () {
        const before = yield* jobs.cancelSession(sessionID)
        const interrupted = yield* sessions.interrupt(sessionID)
        const cancelled = [...before, ...(yield* jobs.cancelSession(sessionID))]
        const below = yield* Effect.forEach(yield* children({ parentID: sessionID, limit: 100 }), (child) =>
          stop(child.id),
        )
        return below.reduce(
          (total, item) => ({ interrupted: total.interrupted + item.interrupted, jobs: total.jobs + item.jobs }),
          {
            interrupted: interrupted ? 1 : 0,
            jobs: cancelled.length,
          },
        )
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
              if (yield* isSelfOrAncestor(input.sessionID, context.sessionID))
                return yield* new ToolFailure({ message: "A session can't interrupt itself or a session above it" })
              const result = yield* stop(input.sessionID)
              return {
                output: { sessionID: input.sessionID, ...result },
                content: `Interrupted session ${input.sessionID}: ${result.interrupted} running, ${result.jobs} jobs cancelled.`,
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to interrupt session ${input.sessionID}`, error }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
