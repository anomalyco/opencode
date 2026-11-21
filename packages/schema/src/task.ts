export * as Task from "./task.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

export const MAX_CONTENT = 500
export const MAX_TASKS = 200

export const Status = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])
export type Status = typeof Status.Type

export interface Item extends Schema.Schema.Type<typeof Item> {}
export const Item = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  status: Status,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "Task.Item" })

const Empty = Schema.toStandardSchemaV1(Schema.Struct({}))

/**
 * The `/task` plugin's RPC. A project's tasks are shared by all of its Sessions. Clients read them with `list` and keep
 * them current from `changed`, which the plugin publishes in the project's Location on every write.
 */
export const Definition = Rpc.define({
  id: "opencode.task",
  methods: {
    list: {
      input: Empty,
      output: Schema.toStandardSchemaV1(Schema.Array(Item)),
    },
    add: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ content: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.NullOr(Item)),
    },
    update: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({ id: Schema.String, content: optional(Schema.String), status: optional(Status) }),
      ),
      output: Schema.toStandardSchemaV1(Schema.NullOr(Item)),
    },
    remove: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.Boolean),
    },
    /** Drops completed and cancelled tasks. Returns how many were removed. */
    clear: {
      input: Empty,
      output: Schema.toStandardSchemaV1(Schema.Number),
    },
  },
  events: {
    changed: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ tasks: Schema.Array(Item) })),
    },
  },
})
