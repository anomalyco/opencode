export * as PlanPlugin from "./plan.js"

import { Message, ToolFailure } from "@opencode-ai/ai"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Global } from "@opencode-ai/util/global"
import { Patch } from "@opencode-ai/util/patch"
import { Effect, Result, Stream } from "effect"
import path from "path"
import { Agent } from "../agent.js"
import { Environment } from "../environment/index.js"
import { SessionEvent } from "../session/event.js"

const plan = Agent.ID.make("plan")

const enter = (directory: string) => `<system-reminder>
You are in Plan mode. You may only edit or create files in the Plan directory: ${directory}
You may not modify files outside that directory, and you may not ask a subagent to do that either.

You are in Plan mode until the user switches agents. Plan mode is not changed by user intent, tone, or imperative language. If the user asks you to change files, do not edit. Tell them they need to switch agents.
</system-reminder>`

const leave = `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`

export const Plugin = define({
  id: "opencode.plan",
  effect: Effect.fn(function* (ctx) {
    const environment = yield* Environment.Service
    const global = yield* Global.Service
    const directory = path.join(global.home, ".opencode", "plan")
    const enterReminder = enter(directory)
    yield* environment.files.mkdir(directory).pipe(Effect.orDie)

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
      const outside = mutationPaths(event.tool, event.input).find((target) => !contained(directory, target))
      if (!outside) return Effect.void
      return new ToolFailure({
        message: `Cannot use ${event.tool} to modify ${outside} in Plan mode. You can only edit files in the Plan directory: ${directory}`,
      })
    })

    // Compaction and committed reverts can strip reminders while the session's agent stays
    // put. Reconcile per request, appending near the tail so the cached prefix stays warm.
    yield* ctx.session.hook("context", (event) => {
      const reminder = lastReminder(event.messages, enterReminder)
      const missing = event.agent === plan && reminder !== enterReminder
      const stale = event.agent !== plan && reminder === enterReminder
      const text = missing ? enterReminder : stale ? leave : undefined
      if (!text) return Effect.void
      // Before the user's prompt, matching where agent-switch reminders land.
      const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length
      event.messages.splice(at, 0, Message.user(text))
      return ctx.session
        .synthetic({ sessionID: event.sessionID, text, resume: false })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to persist Plan mode reminder", { sessionID: event.sessionID, cause }),
          ),
        )
    })

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event): event is SessionEvent.Created | SessionEvent.AgentSelected =>
          event.type === "session.created" || event.type === "session.agent.selected",
      ),
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

function mutationPaths(tool: "edit" | "write" | "patch", input: unknown) {
  if (typeof input !== "object" || input === null) return []
  if (tool !== "patch") {
    const target = Reflect.get(input, "path")
    return typeof target === "string" ? [path.resolve(target)] : []
  }
  const patchText = Reflect.get(input, "patchText")
  if (typeof patchText !== "string") return []
  const parsed = Patch.parse(patchText)
  if (Result.isFailure(parsed)) return []
  return parsed.success.flatMap((hunk) => [
    path.resolve(hunk.path),
    ...(hunk.type === "update" && hunk.movePath ? [path.resolve(hunk.movePath)] : []),
  ])
}

function contained(directory: string, target: string) {
  const relative = path.relative(directory, target)
  return (
    relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
}
