import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

// Parameters are kept inline rather than derived from Todo.Info because
// Tool.define requires z.ZodObject-typed parameters for execute() inference,
// and zodObject(Todo.Info) returns ZodObject<any> — reaching into .shape would
// erase field types. Tool schemas migrate to Effect Schema as a separate slice
// per specs/effect/schema.md.
const parameters = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().describe("Brief description of the task"),
        status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
        priority: z.string().describe("Priority level of the task: high, medium, low"),
      }),
    )
    .describe("The updated todo list"),
})

type Metadata = {
  todos: Todo.Info[]
}

export const TodoWriteTool = Tool.define<typeof parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
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

          return {
            title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
            output: JSON.stringify(params.todos, null, 2),
            metadata: {
              todos: params.todos,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
