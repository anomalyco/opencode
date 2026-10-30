export * as TodoTool from "./todo.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Permission } from "../../permission.js"
import DESCRIPTION from "../todowrite.txt"

export const name = "todowrite"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.Literals(["pending", "in_progress", "completed", "cancelled"]).annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
})
export type Info = typeof Info.Type

export const Input = Schema.Struct({
  todos: Schema.Array(Info).annotate({ description: "The updated todo list" }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(Info),
})
export type Output = typeof Output.Type

export const summarize = (todos: ReadonlyArray<Info>) => {
  if (todos.length === 0) return "Todos cleared"
  const count = (status: Info["status"]) => todos.filter((todo) => todo.status === status).length
  const counts = [
    `${count("completed")}/${todos.length} completed`,
    ...(["in_progress", "pending", "cancelled"] as const).flatMap((status) =>
      count(status) ? [`${count(status)} ${status.replace("_", " ")}`] : [],
    ),
  ].join(", ")
  const active = todos.filter((todo) => todo.status === "in_progress").map((todo) => JSON.stringify(todo.content))
  return `Todos updated: ${counts}${active.length ? `. In progress: ${active.join(", ")}` : ""}`
}

export const Plugin = {
  id: "opencode.tool.todo",
  effect: Effect.fn("TodoTool.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    // Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const enabled = () => Config.latest(loaded.entries, "experimental")?.todo === true

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.add({
          name,
          options: { codemode: false },
          description: DESCRIPTION,
          input: Input,
          output: Output,
          execute: (input, context) =>
            permission
              .assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError((error) => new ToolFailure({ message: "Unable to update todos", error })),
                Effect.as({
                  output: { todos: input.todos },
                  content: summarize(input.todos),
                  metadata: { todos: input.todos },
                }),
              ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
