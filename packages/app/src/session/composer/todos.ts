import type { SessionMessageInfo } from "@opencode/client/promise"

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

export type Todo = {
  content: string
  status: TodoStatus
}

const statuses = new Set<unknown>(["pending", "in_progress", "completed", "cancelled"])

// The experimental `todowrite` tool keeps no server state: the current list is the input of the latest completed call
// before the revert boundary.
export function sessionTodos(messages: readonly SessionMessageInfo[], boundary?: string): Todo[] {
  const end = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  const input = messages
    .slice(0, end === -1 ? messages.length : end)
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .findLast((item) => item.type === "tool" && item.name === "todowrite" && item.state.status === "completed")
  const todos = input?.type === "tool" && input.state.status === "completed" ? input.state.input.todos : undefined

  if (!Array.isArray(todos)) return []

  return todos.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null || !("content" in item) || typeof item.content !== "string") return []
    if (!item.content) return []
    const status = "status" in item && statuses.has(item.status) ? (item.status as TodoStatus) : "pending"

    return [{ content: item.content, status }]
  })
}

/** The todo the agent is on: the one in progress, else the next pending one, else the last finished one. */
export function currentTodo(todos: readonly Todo[]) {
  return (
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status === "pending") ??
    todos.findLast((todo) => todo.status === "completed") ??
    todos[0]
  )
}

export const todoFinished = (todo: Todo) => todo.status === "completed" || todo.status === "cancelled"
