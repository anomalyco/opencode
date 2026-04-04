import {
  pgTable,
  text as pgText,
  bigint as pgBigint,
  index as pgIndex,
  primaryKey as pgPrimaryKey,
  foreignKey as pgForeignKey,
  jsonb,
  boolean as pgBoolean,
} from "drizzle-orm/pg-core"

// Wrap text() to intercept { mode: "json" } and route to jsonb()
function text(nameOrConfig?: any, config?: any) {
  const resolvedConfig = typeof nameOrConfig === "object" && !Array.isArray(nameOrConfig) ? nameOrConfig : config
  if (resolvedConfig?.mode === "json") {
    const name = typeof nameOrConfig === "string" ? nameOrConfig : undefined
    return name ? jsonb(name) : jsonb()
  }
  // Pg text() only accepts an optional name string
  if (typeof nameOrConfig === "string") return pgText(nameOrConfig)
  return pgText()
}

// Map SQLite integer() to Postgres bigint() (SQLite integer is 64-bit, Postgres integer is 32-bit)
// Also intercept { mode: "boolean" } and route to boolean()
function integer(nameOrConfig?: any, config?: any) {
  const resolvedConfig = typeof nameOrConfig === "object" && !Array.isArray(nameOrConfig) ? nameOrConfig : config
  if (resolvedConfig?.mode === "boolean") {
    const name = typeof nameOrConfig === "string" ? nameOrConfig : undefined
    return name ? pgBoolean(name) : pgBoolean()
  }
  // Use bigint in "number" mode to match SQLite's 64-bit integer
  if (typeof nameOrConfig === "string") return pgBigint(nameOrConfig, { mode: "number" })
  return pgBigint({ mode: "number" })
}

export {
  pgTable as table,
  text,
  integer,
  pgIndex as index,
  pgPrimaryKey as primaryKey,
  pgForeignKey as foreignKey,
}
