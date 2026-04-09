import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

const parameters = z.object({
  todos: z.array(z.object(Todo.Info.shape)).describe("The updated todo list"),
})

type Metadata = {
  todos: Todo.Info[]
}

export const TodoWriteTool = Tool.defineEffect<typeof parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters,
      async execute(params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) {
        await ctx.ask({
          permission: "todowrite",
          patterns: ["*"],
          always: ["*"],
          metadata: {},
        })

        await todo
          .update({
            sessionID: ctx.sessionID,
            todos: params.todos,
          })
          .pipe(Effect.runPromise)

        return {
          title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
          output: JSON.stringify(params.todos, null, 2),
          metadata: {
            todos: params.todos,
          },
        }
      },
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
