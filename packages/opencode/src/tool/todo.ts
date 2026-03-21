import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"
import { SessionID } from "../session/schema"
import { Log } from "../util/log"

const log = Log.create({ service: "todo-tool" })

function hasCycle(todos: Todo.Info[]): boolean {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  
  const dependencies = new Map<string, string[]>()
  for (const todo of todos) {
    const id = todo.id || 'temp-' + Math.random().toString(36).substr(2, 9);
    dependencies.set(id, todo.dependsOn || [])
  }
  
  function dfs(nodeId: string): boolean {
    if (recursionStack.has(nodeId)) {
      log.debug("Cycle detected in dependency graph", { nodeId })
      return true
    }
    
    if (visited.has(nodeId)) {
      return false
    }
    
    visited.add(nodeId)
    recursionStack.add(nodeId)
    
    const deps = dependencies.get(nodeId) || []
    for (const dep of deps) {
      if (dfs(dep)) {
        return true
      }
    }
    
    recursionStack.delete(nodeId)
    return false
  }
  
  for (const todo of todos) {
    const id = todo.id || 'temp-' + Math.random().toString(36).substr(2, 9);
    if (!visited.has(id)) {
      if (dfs(id)) {
        log.info("Dependency cycle detected in todo list", { todoCount: todos.length })
        return true
      }
    }
  }
  
  log.debug("No cycles detected in todo dependency graph", { todoCount: todos.length })
  return false
}

async function validateImmutableHistory(sessionID: SessionID, newTodos: Todo.Info[]): Promise<void> {
  const existingTodos = await Todo.get(sessionID)
  const existingIds = new Set(existingTodos.map(todo => todo.id || 'temp-id'))
  const newIds = new Set(newTodos.map(todo => todo.id || 'temp-id'))
  
  for (const id of existingIds) {
    if (!newIds.has(id)) {
      log.warn("Immutable history violation detected", { sessionID, deletedTodoId: id })
      throw new Error(`Immutable history violation: Todo ID ${id} was deleted. Only status updates to 'skipped' are allowed.`)
    }
  }
  
  log.debug("Immutable history validation passed", { sessionID, existingCount: existingTodos.length, newCount: newTodos.length })
}

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

    log.info("Processing todo update request", { sessionID: ctx.sessionID, todoCount: params.todos.length })
    
    await validateImmutableHistory(ctx.sessionID, params.todos)
    
    if (hasCycle(params.todos)) {
      throw new Error("Cycle detected in todo dependencies. Circular dependencies are not allowed.")
    }

    await Todo.update({
      sessionID: ctx.sessionID,
      todos: params.todos,
    })
    
    log.info("Todo update completed successfully", { sessionID: ctx.sessionID, todoCount: params.todos.length })
    
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
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const todos = await Todo.get(ctx.sessionID)
    return {
      title: `${todos.filter((x) => x.status !== "completed").length} todos`,
      metadata: {
        todos,
      },
      output: JSON.stringify(todos, null, 2),
    }
  },
})