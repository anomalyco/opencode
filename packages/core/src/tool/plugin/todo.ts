export * as TodoTool from "./todo.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Todo } from "@opencode/schema/todo"
import { Effect, Option, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import type { SessionMessage } from "../../session/message.js"
import type { SessionSchema } from "../../session/schema.js"
import DESCRIPTION from "../todowrite.txt"

export const name = "todowrite"

export const Info = Todo.Info
export type Info = Todo.Info

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
    const flags = yield* Flag.Service
    const enabled = () => flags.resolve(loaded.entries).todo.enabled

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
                ...Permission.invocation(context),
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

const PAGE = 50
const decodeTodos = Schema.decodeUnknownOption(Schema.Array(Info))

/**
 * Serves `Todo.Definition`. Clients load only a Session's recent messages, so a list written further back needs the
 * server to find it.
 */
export const ListPlugin = {
  id: Todo.Definition.id,
  effect: Effect.fn("TodoTool.ListPlugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const flags = yield* Flag.Service

    // Assistant messages newest first, starting before `before`, until one holds a completed `todowrite` call.
    const latest = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      before: SessionMessage.ID | undefined,
    ): Effect.fn.Return<ReadonlyArray<Info>, Session.NotFoundError | Session.MessageDecodeError> {
      const messages = yield* sessions.messages({
        sessionID,
        type: "assistant",
        order: "desc",
        limit: PAGE,
        cursor: before && { id: before, direction: "next" },
      })
      const tool = messages
        .flatMap((message) => (message.type === "assistant" ? message.content.toReversed() : []))
        .find(
          (item): item is SessionMessage.AssistantTool & { state: SessionMessage.ToolStateCompleted } =>
            item.type === "tool" && item.name === name && item.state.status === "completed",
        )
      if (tool) return Option.getOrElse(decodeTodos(tool.state.input.todos), () => [])
      const last = messages.at(-1)
      if (!last || messages.length < PAGE) return []
      return yield* latest(sessionID, last.id)
    })

    yield* ctx.rpc
      .register(Todo.Definition, {
        get: (input) =>
          Effect.gen(function* () {
            // Without the flag nothing writes todos, so don't scan the history of every Session a client opens.
            if (!(yield* flags.enabled("todo"))) return []
            const session = yield* sessions.get(input.sessionID)
            // The revert boundary is the first hidden message, so the list is the latest one before it.
            return yield* latest(session.id, session.revert?.messageID)
          }).pipe(
            Effect.catchTag("Session.NotFoundError", () => Effect.succeed([])),
            Effect.orDie,
          ),
      })
      .pipe(Effect.orDie)
  }),
}
