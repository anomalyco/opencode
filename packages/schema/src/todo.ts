export * as Todo from "./todo.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { SessionID } from "./session-id.js"

export const Status = Schema.Literals(["pending", "in_progress", "completed", "cancelled"]).annotate({
  description: "Current status of the task: pending, in_progress, completed, cancelled",
})
export type Status = typeof Status.Type

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Status,
})
export type Info = typeof Info.Type

/**
 * The experimental `todowrite` tool's RPC. `get` returns a Session's current list, the input of its latest completed
 * `todowrite` call before the revert boundary, however far back in history that call is. Clients that hold the newer
 * messages read the list from them instead.
 */
export const Definition = Rpc.define({
  id: "opencode.todo",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID })),
      output: Schema.toStandardSchemaV1(Schema.Array(Info)),
    },
  },
  events: {},
})
