import z from "zod/v4"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Instance } from "../project/instance"

const TodoInfo = z.object({
  content: z.string().max(500).describe("Brief description of the task (max 500 characters)"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).describe("Current status of the task"),
  priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level of the task"),
  id: z.string().describe("Unique identifier for the todo item"),
  activeForm: z.string().max(500).optional().describe("Present continuous form shown during execution (e.g., 'Running tests')"),
  tags: z.array(z.string()).optional().describe("Optional tags for categorization"),
  dependencies: z.array(z.string()).optional().describe("IDs of todos that must be completed first"),
  estimate_minutes: z.number().min(1).optional().describe("Estimated time in minutes"),
})
type TodoInfo = z.infer<typeof TodoInfo>

const state = Instance.state(() => {
  const todos: {
    [sessionId: string]: TodoInfo[]
  } = {}
  return todos
})

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(TodoInfo).max(50).describe("The updated todo list (max 50 items)"),
  }),
  async execute(params, opts) {
    // Validate unique IDs
    const ids = params.todos.map((t) => t.id)
    const uniqueIds = new Set(ids)
    if (ids.length !== uniqueIds.size) {
      throw new Error("Todo items must have unique IDs")
    }

    // Validate dependencies exist
    const idSet = new Set(ids)
    for (const todo of params.todos) {
      if (todo.dependencies) {
        for (const depId of todo.dependencies) {
          if (!idSet.has(depId)) {
            throw new Error(`Todo '${todo.id}' has invalid dependency '${depId}' (not found in todo list)`)
          }
        }
      }
      if (todo.activeForm && todo.activeForm.trim().length === 0) {
        throw new Error(`Todo '${todo.id}' must not provide an empty activeForm`)
      }
      if (todo.status === "in_progress" && !todo.activeForm) {
        throw new Error(`Todo '${todo.id}' requires an activeForm while in progress`)
      }
    }

    // Detect circular dependencies
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const todoMap = new Map(params.todos.map((t) => [t.id, t]))

    function hasCycle(todoId: string): boolean {
      if (recursionStack.has(todoId)) return true
      if (visited.has(todoId)) return false

      visited.add(todoId)
      recursionStack.add(todoId)

      const todo = todoMap.get(todoId)
      if (todo?.dependencies) {
        for (const depId of todo.dependencies) {
          if (hasCycle(depId)) return true
        }
      }

      recursionStack.delete(todoId)
      return false
    }

    for (const todo of params.todos) {
      if (hasCycle(todo.id)) {
        throw new Error(`Circular dependency detected involving todo '${todo.id}'`)
      }
    }

    const todos = state()
    todos[opts.sessionID] = params.todos
    return {
      title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
      output: JSON.stringify(params.todos, null, 2),
      metadata: {
        todos: params.todos,
      },
    }
  },
})

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your todo list",
  parameters: z.object({}),
  async execute(_params, opts) {
    const todos = state()[opts.sessionID] ?? []
    return {
      title: `${todos.filter((x) => x.status !== "completed").length} todos`,
      metadata: {
        todos,
      },
      output: JSON.stringify(todos, null, 2),
    }
  },
})
