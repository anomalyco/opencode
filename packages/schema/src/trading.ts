export * as Trading from "./trading.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"

/** An account is null: the engine never invents balances it did not receive from IBKR. */
export const Account = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  cash: Schema.NullOr(Schema.Number),
  equity: Schema.NullOr(Schema.Number),
  pnl_day: Schema.NullOr(Schema.Number),
  pnl_realized: Schema.NullOr(Schema.Number),
}).annotate({ identifier: "Trading.Account" })
export interface Account extends Schema.Schema.Type<typeof Account> {}

export const System = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Live bot process in the pool folder; the engine's own "active" is kept in sync with it. */
  running: Schema.Boolean,
  active: Schema.Boolean,
  /** The bot's process id while running (engine-launched or detected at boot); null otherwise. */
  pid: Schema.NullOr(Schema.Number),
  /** Epoch ms when the engine (re)attached to the running bot; null while it is not running. */
  started_at: Schema.NullOr(Schema.Number),
  symbol: Schema.String,
  timeframe: Schema.String,
  /** The bot's unrealized PnL from its own registro.log portfolio updates; null until seen today. */
  pnl_day: Schema.NullOr(Schema.Number),
}).annotate({ identifier: "Trading.System" })
export interface System extends Schema.Schema.Type<typeof System> {}

export const Position = Schema.Struct({
  symbol: Schema.String,
  side: Schema.Literals(["long", "short"]),
  size: Schema.Number,
  entry: Schema.NullOr(Schema.Number),
  current: Schema.NullOr(Schema.Number),
  pnl: Schema.NullOr(Schema.Number),
  pnl_pct: Schema.NullOr(Schema.Number),
}).annotate({ identifier: "Trading.Position" })
export interface Position extends Schema.Schema.Type<typeof Position> {}

/** The full close cycle's outcome; `message` is the engine's own plain-language verdict (Spanish, as its logs). */
export const PositionCloseResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.String,
}).annotate({ identifier: "Trading.PositionCloseResult" })
export interface PositionCloseResult extends Schema.Schema.Type<typeof PositionCloseResult> {}

export const LogLevel = Schema.Literals(["info", "warning", "error"]).annotate({
  identifier: "Trading.LogLevel",
})
export type LogLevel = typeof LogLevel.Type

export const Log = Schema.Struct({
  ts: Schema.Number,
  level: LogLevel,
  /** The system the entry belongs to, or "motor" for engine-wide events. */
  system: Schema.String,
  message: Schema.String,
  /** The few entries that mark a position lifecycle beat (a bot going into or out of a
   * position, or its entry signal); absent for every other line. */
  event: optional(
    Schema.Literals(["open", "close", "signal"]).annotate({ identifier: "Trading.LogEvent" }),
  ),
}).annotate({ identifier: "Trading.Log" })
export interface Log extends Schema.Schema.Type<typeof Log> {}

export const TaskID = Schema.String.check(Schema.isStartingWith("trd_")).pipe(
  Schema.brand("Trading.TaskID"),
  Schema.annotate({ identifier: "Trading.TaskID" }),
  statics((schema) => ({
    create: () => schema.make("trd_" + ascending()),
  })),
)
export type TaskID = typeof TaskID.Type

/** What a scheduled task does when it fires. v0 only flips the local systems flags; it never places orders. */
export const TaskKind = Schema.Literals(["start-systems", "stop-systems"]).annotate({
  identifier: "Trading.TaskKind",
})
export type TaskKind = typeof TaskKind.Type

/**
 * `pending`: still waiting on `run_at`. `ran`: fired. `missed`: fell due while the app was
 * closed and was skipped. `cancelled`: withdrawn by the user.
 */
export const TaskStatus = Schema.Literals(["pending", "ran", "missed", "cancelled"]).annotate({
  identifier: "Trading.TaskStatus",
})
export type TaskStatus = typeof TaskStatus.Type

export const Task = Schema.Struct({
  id: TaskID,
  kind: TaskKind,
  /** System IDs the task acts on, all validated to exist in the pool; empty means every system. */
  system_ids: Schema.Array(Schema.String),
  /** The run time as epoch ms on the server machine's local (PC) clock. */
  run_at: Schema.Number,
  status: TaskStatus,
  /** Epoch ms when the task fired, was marked missed or was cancelled; null while pending. */
  resolved_at: Schema.NullOr(Schema.Number),
  time_created: Schema.Number,
  time_updated: Schema.Number,
}).annotate({ identifier: "Trading.Task" })
export interface Task extends Schema.Schema.Type<typeof Task> {}

export const Snapshot = Schema.Struct({
  version: Schema.String,
  /** true while the IBKR TWS socket (demo 7497) is up; account and positions are empty otherwise. */
  connected: Schema.Boolean,
  account: Schema.NullOr(Account),
  systems: Schema.Array(System),
  positions: Schema.Array(Position),
  logs: Schema.Array(Log),
  /** Recent scheduled tasks, newest first. */
  tasks: Schema.Array(Task),
}).annotate({ identifier: "Trading.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
