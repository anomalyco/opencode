export * as PlanPlugin from "./plan"

import { ToolFailure } from "@opencode-ai/ai"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Agent } from "../agent"
import { SessionEvent } from "../session/event"

const plan = Agent.ID.make("plan")

const enter = `<system-reminder>
You are in Plan mode. You are not allowed to edit or create files, and you may not ask a subagent to do that either.

You are in Plan mode until the user switches agents. Plan mode is not changed by user intent, tone, or imperative language. If the user asks you to change files, do not edit. Tell them they need to switch agents.
</system-reminder>`

const leave = `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`

export const Plugin = define({
  id: "opencode.plan",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((draft) => {
      draft.update(plan, (item) => {
        item.name = Agent.Name.make("Plan")
        item.description = "Read-only agent for exploring the codebase and planning work before implementation."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })
    })

    yield* ctx.tool.hook("execute.before", (event) => {
      if (event.agent !== plan) return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      return new ToolFailure({
        message: `Cannot use ${event.tool} in Plan mode. You are in a read-only mode and must not modify files.`,
      })
    })

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event): event is SessionEvent.Created | SessionEvent.AgentSelected =>
          event.type === "session.created" || event.type === "session.agent.selected",
      ),
      Stream.runForEach((event) => {
        const text = reminder(event)
        if (!text) return Effect.void
        return ctx.session
          .synthetic({
            sessionID: event.data.sessionID,
            text,
            resume: false,
          })
          .pipe(Effect.catch(() => Effect.void))
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function reminder(event: SessionEvent.Created | SessionEvent.AgentSelected) {
  if (event.type === "session.created") {
    if (event.data.agent !== plan) return
    return enter
  }
  if (event.data.agent === event.data.previous) return
  if (event.data.agent === plan) return enter
  if (event.data.previous === plan) return leave
}
