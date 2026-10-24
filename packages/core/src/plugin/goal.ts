export * as GoalPlugin from "./goal.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { SessionGoalDriver } from "../session/goal-driver.js"
import { SessionContext } from "../session/context.js"

/**
 * The goal round driver's mount point. It lives on the plugin generation, so a
 * plugin reload or an instance switch destroys it and the goal starts disarmed.
 */
export const Plugin = define({
  id: "opencode.goal",
  effect: Effect.fn("GoalPlugin")(function* (ctx) {
    const context = yield* SessionContext.Service
    yield* SessionGoalDriver.run(
      ctx.event.subscribe().pipe(Stream.filter(SessionGoalDriver.isDriverEvent)),
      context,
    ).pipe(Effect.forkScoped({ startImmediately: true }))
  }),
})
