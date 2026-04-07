import { detectDialect } from "./dialect-detect"
import * as sqliteDialect from "./dialect.sqlite"
import * as pgDialect from "./dialect.pg"
import * as mysqlDialect from "./dialect.mysql"

// All dialect modules are imported (and bundled) statically.
// At runtime, we pick the right one based on OPENCODE_DATABASE_URL.
// detectDialect() reads process.env at call time, so it works in compiled binaries.
const mod = (() => {
  const d = detectDialect()
  if (d === "postgres") return pgDialect
  if (d === "mysql") return mysqlDialect
  return sqliteDialect
})()

// Export as SQLite types (the default) for TypeScript compatibility.
// Other dialect constructors are structurally compatible at runtime.
type Mod = typeof sqliteDialect
const typed = mod as unknown as Mod

export const table = typed.table
export const text = typed.text
export const integer = typed.integer
export const index = typed.index
export const primaryKey = typed.primaryKey
export const foreignKey = typed.foreignKey
