import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Database } from "@kancode/core/database/database"

describe("database path", () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("default filename describes the persistent store", () => {
    expect(Database.filename()).toMatch(/^storage(-[a-zA-Z0-9._-]+)?\.db$/)
  })

  test("adopts legacy branded db and WAL sidecars", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kancode-db-"))
    dirs.push(dir)

    const legacy = path.join(dir, "opencode.db")
    const next = path.join(dir, "storage.db")
    await fs.writeFile(legacy, "main")
    await fs.writeFile(`${legacy}-wal`, "wal")
    await fs.writeFile(`${legacy}-shm`, "shm")

    Database.adoptLegacyDatabase(legacy, next)

    expect(await fs.readFile(next, "utf8")).toBe("main")
    expect(await fs.readFile(`${next}-wal`, "utf8")).toBe("wal")
    expect(await fs.readFile(`${next}-shm`, "utf8")).toBe("shm")
    await expect(fs.stat(legacy)).rejects.toThrow()
  })

  test("does not overwrite an existing storage.db", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kancode-db-"))
    dirs.push(dir)

    const legacy = path.join(dir, "opencode.db")
    const next = path.join(dir, "storage.db")
    await fs.writeFile(legacy, "legacy")
    await fs.writeFile(next, "current")

    Database.adoptLegacyDatabase(legacy, next)

    expect(await fs.readFile(next, "utf8")).toBe("current")
    expect(await fs.readFile(legacy, "utf8")).toBe("legacy")
  })
})
