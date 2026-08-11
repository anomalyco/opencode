export * as PlanPlugin from "./plan"

import { ToolFailure } from "@opencode-ai/ai"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, Stream } from "effect"
import { Agent } from "../agent"

const plan = Agent.ID.make("plan")

const enter = `<system-reminder>
You are in Plan mode. This is a READ-ONLY environment. You are not allowed to edit files, and you may not ask a subagent to edit them either.
</system-reminder>`

const leave = `<system-reminder>
You are no longer in Plan mode. The previous read-only restrictions no longer apply. You may edit files again.
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
      Stream.filter((event) => event.type === "session.agent.selected"),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const message = yield* ctx.session.message({
            sessionID: event.data.sessionID,
            messageID: SessionMessage.ID.fromEvent(event.id),
          })
          if (message?.type !== "agent-switched" || message.agent === message.previous) return
          const text = message.agent === plan ? enter : message.previous === plan ? leave : undefined
          if (!text) return
          yield* ctx.session.synthetic({ sessionID: event.data.sessionID, text, resume: false })
        }).pipe(Effect.catch(() => Effect.void)),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
