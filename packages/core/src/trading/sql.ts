import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Trading } from "@opencode/schema/trading"
import { Timestamps } from "../database/schema.sql.js"

export const TradingTaskTable = sqliteTable("trading_task", {
  id: text().$type<Trading.TaskID>().primaryKey(),
  kind: text().$type<Trading.TaskKind>().notNull(),
  /** System IDs the task acts on, deduplicated and validated against the pool at creation; empty means every system. */
  system_ids: text({ mode: "json" }).$type<string[]>().notNull(),
  /** Epoch ms on the server machine's local (PC) clock. */
  run_at: integer().notNull(),
  status: text().$type<Trading.TaskStatus>().notNull().default("pending"),
  /** Epoch ms when the task fired, was marked missed or was cancelled; null while pending. */
  resolved_at: integer(),
  ...Timestamps,
})

/** One closed trade: the bot's own registro.log row (its "FUERA … (±X USD brutos)" verdict or
 * a close-tagged row). (system, ts) is the primary key, so replaying a log tail re-inserts nothing. */
export const TradingTradeTable = sqliteTable(
  "trading_trade",
  {
    system: text().notNull(),
    ts: integer().notNull(),
    /** The bot's stated gross USD result; null when the row carries no figure. */
    pnl: real(),
    message: text().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.system, table.ts] })],
)

/** The daily-loss guard's single row (id "default"), so the limit and its latched state
 * survive restarts. */
export const TradingRiskTable = sqliteTable("trading_risk", {
  id: text().primaryKey(),
  /** USD; 0 disables the guard. */
  loss_day_limit: real().notNull(),
  /** Epoch ms when the guard fired; null while armed. */
  triggered_at: integer(),
  ...Timestamps,
})

/** One registered TWS link beyond the panel's own primary socket: the watch's host:port
 * (its "id") and the user's label, so the links survive engine restarts. */
export const TradingLinkTable = sqliteTable("trading_link", {
  /** "host:port", unique per address. */
  id: text().primaryKey(),
  host: text().notNull(),
  port: integer().notNull(),
  /** The user's own name for the link; null when none was given. */
  label: text(),
  ...Timestamps,
})

/** The engine's small key/value store (one row per key): the remembered active account
 * ("cuenta_activa"), kept across restarts until the account leaves every link. */
export const TradingMetaTable = sqliteTable("trading_meta", {
  id: text().primaryKey(),
  value: text().notNull(),
  ...Timestamps,
})
