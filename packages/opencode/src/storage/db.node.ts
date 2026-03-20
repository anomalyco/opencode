import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

export function init(path: string) {
  const sqlite = new DatabaseSync(path)
  const db = drizzle({ client: sqlite as any })
  return db
}
