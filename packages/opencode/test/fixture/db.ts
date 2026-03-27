import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Database, ClientDatabase } from "../../src/storage/db"

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Database.close()
  ClientDatabase.close()
  await rm(Database.Path, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-wal`, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-shm`, { force: true }).catch(() => undefined)
  await rm(ClientDatabase.Path, { force: true }).catch(() => undefined)
  await rm(`${ClientDatabase.Path}-wal`, { force: true }).catch(() => undefined)
  await rm(`${ClientDatabase.Path}-shm`, { force: true }).catch(() => undefined)
}
