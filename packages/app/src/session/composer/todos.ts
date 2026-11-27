import type { SessionMessageInfo } from "@opencode/client/promise"
import { messagesBeforeRevert, type RevertBoundary } from "@opencode/client/solid"
import { Option, Schema } from "effect"

const Status = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])

export type TodoStatus = typeof Status.Type

export type Todo = {
  content: string
  status: TodoStatus
}

// The tool input is the model's JSON, so each entry is read on its own: one malformed entry drops only itself, and an
// unknown status reads as pending.
const decodeEntries = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))

const decodeEntry = Schema.decodeUnknownOption(
  Schema.Struct({ content: Schema.NonEmptyString, status: Schema.optional(Schema.Unknown) }),
)

const decodeStatus = Schema.decodeUnknownOption(Status)

// The experimental `todowrite` tool keeps no server state: the current list is the input of the latest completed call
// before the revert boundary.
export function sessionTodos(messages: readonly SessionMessageInfo[], revert?: RevertBoundary): Todo[] {
  const input = (revert ? messagesBeforeRevert(messages, revert) : messages)
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .findLast((item) => item.type === "tool" && item.name === "todowrite" && item.state.status === "completed")

  const todos = input?.type === "tool" && input.state.status === "completed" ? input.state.input.todos : undefined

  return Option.getOrElse(decodeEntries(todos), () => []).flatMap((value) =>
    Option.match(decodeEntry(value), {
      onNone: () => [],
      onSome: (entry) => [
        { content: entry.content, status: Option.getOrElse(decodeStatus(entry.status), () => "pending" as const) },
      ],
    }),
  )
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
