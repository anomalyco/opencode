import { Database } from "bun:sqlite"
import path from "path"

export function resolveEaLabDbPath(input?: string) {
  const value = input?.trim()
  if (value) return value
  return path.join(process.cwd(), "memory", "sqlite", "ea-lab.sqlite3")
}

export function openEaLabDatabase(input?: string, create = true) {
  return new Database(resolveEaLabDbPath(input), { create })
}
