import { z } from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { App } from "../app/app"
import { TodoInfo } from "../util/schema"


const state = App.state("todo-tool", () => {
  const todos: {
    [sessionId: string]: TodoInfo[]
  } = {}
  return todos
})

export const TodoWriteTool = Tool.define({
  id: "todowrite",
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(TodoInfo).describe("The updated todo list"),
  }),
  async execute(params, opts) {
    const todos = state()
    todos[opts.sessionID] = params.todos
    return {
      output: JSON.stringify(params.todos, null, 2),
      metadata: {
        title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
        todos: params.todos,
      },
    }
  },
})

export const TodoReadTool = Tool.define({
  id: "todoread",
  description: "Use this tool to read your todo list",
  parameters: z.object({}),
  async execute(_params, opts) {
    const todos = state()[opts.sessionID] ?? []
    return {
      metadata: {
        todos,
        title: `${todos.filter((x) => x.status !== "completed").length} todos`,
      },
      output: JSON.stringify(todos, null, 2),
    }
  },
})
