export * as PlanPlugin from "./plan.js"

import { Message, ToolFailure } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Global } from "@opencode/util/global"
import { Effect, Stream } from "effect"
import path from "path"
import { Permission } from "../permission.js"

const plan = Agent.ID.make("plan")

const enter = (directory: string) => `<system-reminder>
You are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:
${directory}

Do not modify any other files or ask a subagent to do so.

You remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.
</system-reminder>`

const leave = `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`

export const Plugin = define({
  id: "opencode.plan",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const directory = path.join(global.home, ".opencode", "plan")
    const enterReminder = enter(directory)
    yield* ctx.agent.transform((editor) => {
      editor.update(plan, (item) => {
        item.name = Agent.Name.make("Plan")
        item.description = "Read-only agent for exploring the codebase and planning work before implementation."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
        item.permissions.push({ action: "edit", resource: "*", effect: "deny" })
        item.permissions.push({ action: "edit", resource: path.join(directory, "*"), effect: "allow" })
      })
    })

    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.agent !== plan) return Effect.void
      if (event.status !== "error") return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      if (!(event.error.error instanceof Permission.BlockedError)) return Effect.void
      event.error = new ToolFailure({
        message: `Cannot use ${event.tool} to modify files outside the Plan directory: ${directory}`,
      })
      return Effect.void
    })

    // Compaction and committed reverts can strip reminders while the session's agent stays
    // put. Reconcile per request. The persisted copy lands after this step, so the request's
    // copy is request-local text at the tail: cache breakpoints stay on the history before it.
    yield* ctx.session.hook("context", (event) => {
      const reminder = lastReminder(event.messages, enterReminder)
      const missing = event.agent === plan && reminder !== enterReminder
      const stale = event.agent !== plan && reminder === enterReminder
      const text = missing ? enterReminder : stale ? leave : undefined
      if (!text) return Effect.void
      const part = { ...Message.text(text), transient: true }
      const last = event.messages.at(-1)
      // A spread keeps the stored metadata that later hooks read on this message; a new UserMessage would drop it.
      if (last?.role === "user")
        event.messages[event.messages.length - 1] = { ...last, content: [...last.content, part] }
      else event.messages.push(Message.user([part]))
      return ctx.session
        .synthetic({ sessionID: event.sessionID, text, resume: false })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to persist Plan mode reminder", { sessionID: event.sessionID, cause }),
          ),
        )
    })

    yield* ctx.event.subscribe({ types: ["session.created", "session.agent.selected"] }).pipe(
      Stream.runForEach((event) => {
        const text = switchReminder(event, enterReminder)
        if (!text) return Effect.void
        return ctx.session
          .synthetic({
            sessionID: event.data.sessionID,
            text,
            resume: false,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to inject Plan mode reminder", { sessionID: event.data.sessionID, cause }),
            ),
          )
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function switchReminder(
  event: SessionEvent.Created | SessionEvent.AgentSelected,
  enterReminder: string,
): string | undefined {
  if (event.type === "session.created") {
    if (event.data.agent !== plan) return undefined
    return enterReminder
  }
  if (event.data.agent === event.data.previous) return undefined
  if (event.data.agent === plan) return enterReminder
  if (event.data.previous === plan) return leave
  return undefined
}

function lastReminder(messages: ReadonlyArray<Message>, enterReminder: string) {
  return messages.reduce<string | undefined>((found, message) => {
    const part = message.role === "user" && message.content.length === 1 ? message.content[0] : undefined
    if (part?.type !== "text") return found
    return part.text === enterReminder || part.text === leave ? part.text : found
  }, undefined)
}
