export type Dialect = "sqlite" | "postgres"

export function detectDialect(): Dialect {
  const url = process.env.OPENCODE_DATABASE_URL
  if (!url) return "sqlite"
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgres"
  return "sqlite"
}

export const DIALECT: Dialect = detectDialect()
