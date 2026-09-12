import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

export const Parameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(Todo.Info)).annotate({ description: "The updated todo list" }),
})

type Metadata = {
  todos: Todo.Info[]
}

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          yield* todo.update({
            sessionID: ctx.sessionID,
            todos: params.todos,
          })

          const open = params.todos.filter((x) => x.status === "pending" || x.status === "in_progress")
          const note = open.length
            ? `Todo list updated. ${open.length} item(s) still open. Keep using todowrite as you work: mark each item completed as soon as it is actually done, and do not batch completions.`
            : "Todo list updated. All items are completed or cancelled."

          return {
            title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
            output: [note, JSON.stringify(params.todos, null, 2)].join("\n\n"),
            metadata: {
              todos: params.todos,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
