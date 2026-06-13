import {
  pgTable as table,
  text as pgText,
  primaryKey,
  index as pgIndex,
  uniqueIndex,
  foreignKey as pgForeignKey,
  customType as pgCustomType,
  doublePrecision,
  jsonb,
  boolean as pgBoolean,
  bigint,
} from "drizzle-orm/pg-core"

function text(nameOrConfig?: any, config?: any) {
  const resolvedConfig = typeof nameOrConfig === "object" && !Array.isArray(nameOrConfig) ? nameOrConfig : config
  if (resolvedConfig?.mode === "json") {
    const name = typeof nameOrConfig === "string" ? nameOrConfig : undefined
    return name ? jsonb(name) : jsonb()
  }
  if (typeof nameOrConfig === "string") return pgText(nameOrConfig)
  return pgText()
}

function integer(nameOrConfig?: any, config?: any) {
  const resolvedConfig = typeof nameOrConfig === "object" && !Array.isArray(nameOrConfig) ? nameOrConfig : config
  if (resolvedConfig?.mode === "boolean") {
    const name = typeof nameOrConfig === "string" ? nameOrConfig : undefined
    return name ? pgBoolean(name) : pgBoolean()
  }
  if (typeof nameOrConfig === "string") return bigint(nameOrConfig, { mode: "number" })
  return bigint({ mode: "number" })
}

const real = doublePrecision

export {
  table,
  text,
  integer,
  real,
  primaryKey,
  pgIndex as index,
  uniqueIndex,
  pgForeignKey as foreignKey,
  pgCustomType as customType,
}
