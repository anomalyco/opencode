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

    const todosArray = Array.isArray(params.todos) ? params.todos : []

    await Todo.update({
      sessionID: ctx.sessionID,
      todos: todosArray,
    })
    return {
      title: `${todosArray.filter((x) => x.status !== "completed").length} todos`,
      output: JSON.stringify(todosArray, null, 2),
      metadata: {
        todos: todosArray,
      },
    }
  },
})

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your todo list",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const todos = await Todo.get(ctx.sessionID)
    const todosArray = Array.isArray(todos) ? todos : []
    return {
      title: `${todosArray.filter((x) => x.status !== "completed").length} todos`,
      metadata: {
        todos: todosArray,
      },
      output: JSON.stringify(todosArray, null, 2),
    }
  },
})
