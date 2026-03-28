import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(z.object(Todo.Info.shape)).describe("The updated todo list"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    Todo.update({
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
  },
})
