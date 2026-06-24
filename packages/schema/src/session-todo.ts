export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define } from "./event"
import { SessionID } from "./session-id"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
}).annotate({ identifier: "Todo" })
export type Info = typeof Info.Type
export const SessionTodoInfo = Info

export const Event = {
  Updated: define({
    type: "todo.updated",
    schema: {
      sessionID: SessionID.ID,
      todos: Schema.Array(Info),
    },
  }),
}
export const SessionTodoEvent = Event
