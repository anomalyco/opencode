import { Database } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"

export const DEFAULT_OPENCODE_DB = path.join(
  process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
  "opencode",
  "opencode.db",
)

export const DEFAULT_MEMORY_DB = path.join(
  process.env.OPENCODE_TRADE_DATA_DIR ?? path.join(os.homedir(), ".local", "share", "opencode-trade"),
  "memory.sqlite3",
)

const DEFAULT_OPENCODE_DATA_DIR = path.dirname(DEFAULT_OPENCODE_DB)
const DEFAULT_OPENCODE_DB_CANDIDATES = [DEFAULT_OPENCODE_DB, path.join(DEFAULT_OPENCODE_DATA_DIR, "opencode-beta.db")]

export function openDatabase(filename: string, readonly: boolean) {
  if (!filename.trim()) throw new Error("database path must not be empty")
  const dir = path.dirname(filename)
  if (!readonly) fs.mkdirSync(dir, { recursive: true })
  return new Database(filename, { readonly, create: !readonly })
}

export function resolveSourceDbPath(input: string | undefined) {
  if (!input) return requireExistingSourceDbPath(DEFAULT_OPENCODE_DB_CANDIDATES)
  if (path.isAbsolute(input) || input === ":memory:") return input
  return path.join(DEFAULT_OPENCODE_DATA_DIR, input)
}

export function resolveIndexDbPath(input: string | undefined) {
  const resolved = input?.trim() || DEFAULT_MEMORY_DB
  if (!resolved.trim()) throw new Error("resolved memory database path must not be empty")
  return resolved
}

function requireExistingSourceDbPath(candidates: string[]) {
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (found) return found
  throw new Error(`source opencode.db not found. checked: ${candidates.join(", ")}`)
}
