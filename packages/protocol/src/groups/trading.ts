import { Trading } from "@opencode/schema/trading"
import { Schema } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"
import { InvalidRequestError, TradingSystemNotFoundError, TradingTaskNotFoundError } from "../errors.js"

const EXPERIMENTAL = "Experimental: may change without compatibility guarantees."
const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.trading.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    // The routes share the `server.experimental` group with the persistent PTY prototype; tag them on their own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

export const PositionCloseParams = { symbol: Schema.String }
const params = { systemID: Schema.String }
const taskParams = { taskID: Trading.TaskID }

export const TaskAddPayload = Schema.Struct({
  kind: Trading.TaskKind,
  /** System IDs to act on; empty or omitted means every system in the pool. */
  systemIDs: Schema.optional(Schema.Array(Schema.String)),
  /** Minutes from now on the server's local (PC) clock; mutually exclusive with `atTime`. */
  delayMinutes: Schema.optional(Schema.Number),
  /** The next local wall-clock time "HH:MM" (PC clock; tomorrow when it is past today already); mutually exclusive with `delayMinutes`. */
  atTime: Schema.optional(Schema.String),
}).annotate({ identifier: "Trading.TaskAddPayload" })
export type TaskAddPayload = typeof TaskAddPayload.Type

export const RiskUpdatePayload = Schema.Struct({
  /** USD daily-loss limit; 0 disables the guard. */
  lossDayLimit: Schema.Number,
}).annotate({ identifier: "Trading.RiskUpdatePayload" })
export type RiskUpdatePayload = typeof RiskUpdatePayload.Type

export const LinkAddPayload = Schema.Struct({
  /** The TWS host; omitted means the engine's own host. */
  host: Schema.optional(Schema.String),
  /** The TWS API port (7496 is the live port, 7497 the demo one). */
  port: Schema.Number,
  /** The user's own name for the link; shown beside its address. */
  label: Schema.optional(Schema.String),
}).annotate({ identifier: "Trading.LinkAddPayload" })
export type LinkAddPayload = typeof LinkAddPayload.Type

const linkParams = { linkID: Schema.String }

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const TradingEndpoints = [
  HttpApiEndpoint.get("trading.snapshot", "/api/experimental/trading/snapshot", {
    success: Schema.Struct({ data: Trading.Snapshot }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "snapshot",
      "Read the trading engine snapshot",
      "Read the engine's whole state: IBKR connection, demo account, the pool of systems, open positions and the recent event log. Read-only; it never places orders.",
    ),
  ),
  HttpApiEndpoint.post("trading.system.activate", "/api/experimental/trading/system/:systemID/activate", {
    params,
    success: Schema.Struct({ data: Trading.System }),
    error: [InvalidRequestError, TradingSystemNotFoundError],
  }).annotateMerge(
    annotations(
      "system.activate",
      "Activate a trading system",
      "Mark one of the pool's systems as running. v0 keeps this state local; it does not contact IBKR.",
    ),
  ),
  HttpApiEndpoint.post("trading.system.pause", "/api/experimental/trading/system/:systemID/pause", {
    params,
    success: Schema.Struct({ data: Trading.System }),
    error: [InvalidRequestError, TradingSystemNotFoundError],
  }).annotateMerge(
    annotations(
      "system.pause",
      "Pause a trading system",
      "Mark one of the pool's systems as stopped. v0 keeps this state local; it does not contact IBKR.",
    ),
  ),
  HttpApiEndpoint.post("trading.position.close", "/api/experimental/trading/position/:symbol/close", {
    params: PositionCloseParams,
    success: Schema.Struct({ data: Trading.PositionCloseResult }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "position.close",
      "Close a trading position",
      "Run the full close cycle for one position of the IBKR account: cancel the contract's open orders, send the opposite market order allowed outside regular hours and, when it cannot execute, fall back to two OCA GTC limit orders one point either side of the last price (one fills, the other cancels; nothing reopens). Always called behind the user's explicit confirmation in the dashboard; it never invents orders when TWS refuses.",
    ),
  ),
  HttpApiEndpoint.post(
    "trading.position.closeAll",
    "/api/experimental/trading/positions/close-all",
    {
      success: Schema.Struct({ data: Trading.PositionCloseResult }),
      error: [InvalidRequestError],
    },
  ).annotateMerge(
    annotations(
      "positions.closeAll",
      "Close all open positions",
      "The emergency counterpart of the single close: run the full close cycle over every open position of the IBKR account in turn — cancel the contract's open orders, send the opposite market order allowed outside regular hours and, when it cannot execute, fall back to two OCA GTC limit orders one point either side of the last price. One failure never stops the rest; the message lists each symbol's verdict. Always called behind the user's explicit confirmation in the dashboard.",
    ),
  ),
  HttpApiEndpoint.get(
    "trading.task.list",
    "/api/experimental/trading/task", {
    success: Schema.Struct({ data: Schema.Array(Trading.Task) }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "task.list",
      "List scheduled trading tasks",
      "List the engine's scheduled tasks (start/stop systems), newest first, including pending, ran, missed and cancelled ones.",
    ),
  ),
  HttpApiEndpoint.post("trading.task.add", "/api/experimental/trading/task", {
    payload: TaskAddPayload,
    success: Schema.Struct({ data: Trading.Task }),
    error: [InvalidRequestError, TradingSystemNotFoundError],
  }).annotateMerge(
    annotations(
      "task.add",
      "Schedule a trading task",
      "Schedule one of the engine's tasks: start or stop systems at a run time on the server's local PC clock, given as a wait in minutes or a local HH:MM. Tasks are persisted; a task that falls due while the app is closed is marked missed instead of firing late.",
    ),
  ),
  HttpApiEndpoint.post("trading.task.cancel", "/api/experimental/trading/task/:taskID/cancel", {
    params: taskParams,
    success: Schema.Struct({ data: Trading.Task }),
    error: [InvalidRequestError, TradingTaskNotFoundError],
  }).annotateMerge(
    annotations(
      "task.cancel",
      "Cancel a scheduled trading task",
      "Cancel a pending scheduled task so it never fires. Already resolved tasks (ran, missed or cancelled) cannot be cancelled.",
    ),
  ),
  HttpApiEndpoint.post("trading.connect", "/api/experimental/trading/connect", {
    success: Schema.Struct({ data: Schema.NullOr(Trading.Account) }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "connect",
      "Connect the engine to TWS",
      "Link the engine's TWS socket up; nothing connects at boot or on any automation's behalf. The socket retries every 5 s until TWS accepts, and the account, positions and P/L start flowing afterwards. Returns the account (null while the balances have not arrived yet).",
    ),
  ),
  HttpApiEndpoint.post("trading.disconnect", "/api/experimental/trading/disconnect", {
    success: Schema.Struct({ data: Schema.NullOr(Trading.Account) }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "disconnect",
      "Disconnect the engine from TWS",
      "Drop the engine's TWS socket and stop the reconnect chase; account, positions and P/L drain until the next connect. The pool's running bots are untouched. Returns null.",
    ),
  ),
  HttpApiEndpoint.post("trading.panic", "/api/experimental/trading/panic", {
    success: Schema.Struct({ data: Trading.PanicResult }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "panic",
      "Trigger the trading panic stop",
      "Stop every running bot immediately (the engine's pid-guarded kill path) and then run the emergency close-all over every open position, whether or not any bot was running. Nothing is re-armed afterwards; the systems stay stopped until reactivated. Always called behind the user's explicit confirmation in the dashboard.",
    ),
  ),
  HttpApiEndpoint.post("trading.risk.update", "/api/experimental/trading/risk", {
    payload: RiskUpdatePayload,
    success: Schema.Struct({ data: Trading.Risk }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "risk.update",
      "Update the daily-loss limit",
      "Set the engine's daily-loss guard: when the account's day P/L reaches the minus limit while trading, every running bot is stopped and the guard stays latched until the day P/L recovers above the limit. A limit of 0 disables the guard. Persisted across restarts.",
    ),
  ),
  HttpApiEndpoint.post("trading.account.select", "/api/experimental/trading/account/:accountID/select", {
    params: { accountID: Schema.String },
    success: Schema.Struct({ data: Schema.NullOr(Trading.Account) }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "account.select",
      "Select the dashboard's active account",
      "Switch the account `snapshot.account` shows: every account field, the KPI strip and the equity curve follow the selection. The input must name an account one of the engine's links has discovered. The selection is remembered across restarts while the account appears again in any link.",
    ),
  ),
  HttpApiEndpoint.post("trading.link.add", "/api/experimental/trading/link", {
    payload: LinkAddPayload,
    success: Schema.Struct({ data: Trading.Link }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "link.add",
      "Register an extra TWS link",
      "Register a second TWS address as a permanent balance watch: the engine opens its own socket (retries every 5 s until TWS accepts), discovers that login's accounts and lists them beside the primary's. A link never places orders. Already-registered addresses are refused. Persisted across restarts.",
    ),
  ),
  HttpApiEndpoint.delete("trading.link.remove", "/api/experimental/trading/link/:linkID", {
    params: linkParams,
    success: Schema.Struct({ data: Schema.Array(Trading.Link) }),
    error: [InvalidRequestError],
  }).annotateMerge(
    annotations(
      "link.remove",
      "Remove a registered TWS link",
      "Withdraw a registered link: its socket drops and its accounts stop listing. The panel's own primary link is never removable. Returns the remaining links.",
    ),
  ),
] as const
