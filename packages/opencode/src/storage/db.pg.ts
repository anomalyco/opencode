import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

export function init(url: string) {
  const client = postgres(url)
  const db = drizzle({ client })
  return db
}
