export type Dialect = "sqlite" | "postgres" | "mysql"

export function detectDialect(): Dialect {
  const url = process.env.OPENCODE_DATABASE_URL
  if (!url) return "sqlite"
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgres"
  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) return "mysql"
  return "sqlite"
}

export const DIALECT: Dialect = detectDialect()
