import { rm } from "fs/promises"
import { Database } from "@opencode-ai/core/database/database"
import { disposeAllInstances } from "./fixture"

export async function resetDatabase() {
  await disposeAllInstances().catch(() => undefined)
  const dbPath = Database.path()
  await rm(dbPath, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-shm`, { force: true }).catch(() => undefined)
}
