import { rm } from "fs/promises"
import { Database } from "@/storage/db"
import { disposeAllInstances } from "./fixture"

export async function resetDatabase() {
  await disposeAllInstances().catch(() => undefined)
  Database.close()
  await rm(Database.Path, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-wal`, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-shm`, { force: true }).catch(() => undefined)
}
