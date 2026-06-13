export * as DatabaseDialect from "./dialect"

import * as sqliteMod from "./dialect.sqlite"
import * as pgMod from "./dialect.pg"

export type Dialect = "sqlite" | "postgres"

const POSTGRES_PREFIXES = ["postgres://", "postgresql://"]

function detectFromUrl(url: string): Dialect {
  if (POSTGRES_PREFIXES.some((prefix) => url.toLowerCase().startsWith(prefix))) return "postgres"
  return "sqlite"
}

export function detect(): Dialect {
  const url = process.env.OPENCODE_DATABASE_URL
  if (url) return detectFromUrl(url)
  return "sqlite"
}

export function isPostgres(): boolean {
  return detect() === "postgres"
}

export function pgUrl(): string | undefined {
  const url = process.env.OPENCODE_DATABASE_URL
  if (!url) return
  if (POSTGRES_PREFIXES.some((prefix) => url.toLowerCase().startsWith(prefix))) return url
  return
}

export function sqlitePath(): string | undefined {
  const url = process.env.OPENCODE_DATABASE_URL
  if (!url) return process.env.OPENCODE_DB
  if (detectFromUrl(url) === "sqlite") return url
  return process.env.OPENCODE_DB
}

const mod = isPostgres() ? pgMod : sqliteMod

type Mod = typeof sqliteMod
const typed = mod as unknown as Mod

export const table = typed.table
export const text = typed.text
export const integer = typed.integer
export const real = typed.real
export const primaryKey = typed.primaryKey
export const index = typed.index
export const uniqueIndex = typed.uniqueIndex
export const foreignKey = typed.foreignKey
export const customType = typed.customType

export const Timestamps = {
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
  time_updated: integer()
    .notNull()
    .$onUpdate(() => Date.now()),
}
