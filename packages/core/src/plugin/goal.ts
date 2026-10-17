export * as GoalPlugin from "./goal.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { SessionGoalActivation } from "../session/goal-activation.js"
import { SessionGoalDriver } from "../session/goal-driver.js"
import { SessionContext } from "../session/context.js"
/**
 * The goal round driver's mount point. It lives on the plugin generation, so a
 * plugin reload or an instance switch destroys it and the goal starts disarmed.
 */
export const Plugin = define({
  id: "opencode.goal",
  effect: Effect.fn("GoalPlugin")(function* (ctx) {
    const activation = yield* SessionGoalActivation.Service
    const context = yield* SessionContext.Service
    yield* ctx.event
      .subscribe()
      .pipe(
        Stream.filter(SessionGoalDriver.isDriverEvent),
        Stream.runForEach((event) =>
          SessionGoalDriver.handle(event, context).pipe(
            // A failure anywhere in the driver — a failed verification, a failed
            // checkpoint write — leaves the durable phase alone and stops this
            // process from driving the goal. Fail closed; the user resumes.
            Effect.catchCause((cause) =>
              Effect.logError("goal driver failed", cause).pipe(
                Effect.andThen(activation.disarm(event.data.sessionID)),
              ),
            ),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})
