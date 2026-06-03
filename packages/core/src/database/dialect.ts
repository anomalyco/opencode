export * as DatabaseDialect from "./dialect"

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
