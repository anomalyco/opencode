import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Database.close()

  const files = [Database.Path, `${Database.Path}-wal`, `${Database.Path}-shm`]
  for (let i = 0; i < 20; i++) {
    await Promise.all(files.map((file) => rm(file, { force: true }).catch(() => undefined)))
    const exists = await Promise.all(files.map((file) => Bun.file(file).exists()))
    if (exists.every((x) => !x)) return
    await Bun.sleep(50)
  }
}
