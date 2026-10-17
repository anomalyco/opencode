export * as SessionGoal from "./session-goal.js"

import { Schema } from "effect"
import { descending } from "./identifier.js"
import { optional, statics } from "./schema.js"

/** Server-generated goal identity. Clients never supply it, so an id is never reused. */
export const ID = Schema.String.check(Schema.isStartingWith("goal_")).pipe(
  Schema.brand("SessionGoal.ID"),
  Schema.annotate({ identifier: "SessionGoal.ID" }),
  statics((schema) => ({ create: () => schema.make("goal_" + descending()) })),
)
export type ID = typeof ID.Type

export const Phase = Schema.Literals(["active", "paused", "blocked", "complete"])
export type Phase = typeof Phase.Type

export interface Reason extends Schema.Schema.Type<typeof Reason> {}
export const Reason = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "SessionGoal.Reason" })

export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({
  id: ID,
  /** CAS reference; every durable mutation increments it. */
  revision: Schema.Number,
  objective: Schema.String,
  phase: Phase,
  blockedReason: optional(Reason),
  maxGoalRounds: Schema.Number,
}).annotate({ identifier: "SessionGoal.Snapshot" })

export const TodoStatus = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])
export type TodoStatus = typeof TodoStatus.Type

export interface TodoItem extends Schema.Schema.Type<typeof TodoItem> {}
export const TodoItem = Schema.Struct({
  position: Schema.Number,
  content: Schema.String,
  status: TodoStatus,
  /** Verifier-owned: how this item is judged done. */
  acceptance: optional(Schema.String),
  /** Verifier-owned: why the last verification did not pass this item. */
  feedback: optional(Schema.String),
}).annotate({ identifier: "SessionGoal.TodoItem" })

/** The model-authored subset of a todo item; position is the array index. */
export interface TodoInput extends Schema.Schema.Type<typeof TodoInput> {}
export const TodoInput = Schema.Struct({
  content: Schema.String,
  status: TodoStatus,
  acceptance: optional(Schema.String),
}).annotate({ identifier: "SessionGoal.TodoInput" })

/** One verifier verdict per todo position; feedback is verifier-owned. */
export interface TodoVerification extends Schema.Schema.Type<typeof TodoVerification> {}
export const TodoVerification = Schema.Struct({
  position: Schema.Number,
  status: TodoStatus,
  feedback: Schema.String,
}).annotate({ identifier: "SessionGoal.TodoVerification" })

/**
 * The goal read model. `createdAt` is the durable row's creation time (the only
 * source of elapsed time), and `armed` is process-local truth: whether this
 * OpenCode process is currently willing to run the goal.
 */
export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  goal: optional(Snapshot),
  createdAt: optional(Schema.Number),
  rounds: Schema.Number,
  maxGoalRounds: Schema.Number,
  armed: Schema.Boolean,
  todo: Schema.Array(TodoItem),
}).annotate({ identifier: "SessionGoal.State" })
