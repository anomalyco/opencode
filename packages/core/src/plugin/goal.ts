export * as GoalPlugin from "./goal.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { Effect, Option, Schema, Stream } from "effect"

const GoalState = Schema.Struct({
  goal: Schema.String,
  active: Schema.Boolean,
})

const workers = new WeakSet<object>()

export const Plugin = define({
  id: "opencode.goal",
  effect: Effect.fn(function* (ctx) {
    const key = (sessionID: Session.ID) => `session/${sessionID}/goal`
    const read = Effect.fn(function* (sessionID: Session.ID) {
      return Option.getOrUndefined(Schema.decodeUnknownOption(GoalState)(yield* ctx.storage.get(key(sessionID))))
    })

    const evaluate = Effect.fn(function* (sessionID: Session.ID) {
      const state = yield* read(sessionID)
      if (!state?.active) return

      const result = yield* ctx.session.generate({
        sessionID,
        prompt: [
          "Evaluate progress toward the goal below using the current session context.",
          "Reply with exactly COMPLETE if it is fully complete.",
          "Otherwise reply with CONTINUE followed by one concise instruction for the next step.",
          `Goal: ${state.goal}`,
        ].join("\n\n"),
      })
      const current = yield* read(sessionID)
      if (!current?.active || current.goal !== state.goal) return

      const evaluation = result.text.trim()
      if (/^COMPLETE\b/i.test(evaluation)) {
        yield* ctx.session.synthetic({
          sessionID,
          text: `Goal: ${state.goal}\n\nThe goal has been completed.`,
          description: "Goal completed",
          delivery: "steer",
          resume: false,
        })
        yield* ctx.storage.set(key(sessionID), { goal: state.goal, active: false })
        return
      }

      yield* ctx.session.synthetic({
        sessionID,
        text: [
          `Goal: ${state.goal}`,
          `Next step: ${evaluation.replace(/^CONTINUE\s*/i, "")}`,
          "Continue working autonomously until the goal is complete.",
        ].join("\n\n"),
        description: "Goal continuing",
        delivery: "steer",
        resume: true,
      })
    })

    if (!workers.has(ctx.app)) {
      workers.add(ctx.app)
      yield* ctx.event.subscribe().pipe(
        Stream.mapEffect(
          (event) => {
            if (event.type !== "session.execution.succeeded") return Effect.void
            return evaluate(event.data.sessionID).pipe(
              Effect.catch((error) =>
                Effect.logError("goal evaluation failed", { sessionID: event.data.sessionID, error }),
              ),
            )
          },
          { concurrency: "unbounded", unordered: true },
        ),
        Stream.runDrain,
        Effect.forkDetach({ startImmediately: true }),
      )
    }

    yield* ctx.command.transform((draft) => {
      draft.add({
        name: "goal",
        description: "Work autonomously toward a goal",
        execute: Effect.fn(function* ({ sessionID, prompt, delivery }) {
          const goal = prompt.text.trim()
          if (!goal) return yield* Effect.fail(new Error("Usage: /goal <goal>"))
          yield* ctx.storage.set(key(sessionID), { goal, active: true })
          yield* ctx.session.synthetic({
            sessionID,
            text: `Goal: ${goal}\n\nContinue until the goal is fully complete. Use tools and make changes as needed.`,
            description: `Goal started: ${goal}`,
            delivery,
            resume: true,
          })
        }),
      })
    })
  }),
})
