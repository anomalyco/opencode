import { DIALECT } from "./dialect-detect"
import type * as SqliteDialect from "./dialect.sqlite"

// At runtime, load the correct dialect's constructors.
// Typed as SQLite (the default) — Postgres constructors are cast to match.
const mod: typeof SqliteDialect =
  DIALECT === "postgres"
    ? ((await import("./dialect.pg")) as unknown as typeof SqliteDialect)
    : await import("./dialect.sqlite")

export const table = mod.table
export const text = mod.text
export const integer = mod.integer
export const index = mod.index
export const primaryKey = mod.primaryKey
export const foreignKey = mod.foreignKey
