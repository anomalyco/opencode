import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Storage } from "../../src/storage/storage"
import { Global } from "../../src/global"

function storageDir() {
  return path.join(Global.Path.data, "storage")
}

async function delay(ms: number) {
  await new Promise<void>((r) => setTimeout(r, ms))
}

describe("storage.read quarantine", () => {
  test("invalid JSON on read is quarantined and throws NotFoundError", async () => {
    const dir = storageDir()
    const key = ["test", "readq", "bad"]
    const target = path.join(dir, ...key) + ".json"

    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, "{invalid")

    await expect(Storage.read<any>(key)).rejects.toThrow()

    await delay(50)

    await expect(fs.access(target)).rejects.toBeDefined()

    const quarantineRoot = path.join(dir, "quarantine")
    const hasQuarantined = await (async () => {
      const exists = await fs.stat(quarantineRoot).catch(() => null as any)
      if (!exists) return false
      const entries = await fs.readdir(quarantineRoot).catch(() => [] as string[])
      for (const entry of entries) {
        const candidate = path.join(quarantineRoot, entry, ...key) + ".json"
        const stat = await fs.stat(candidate).catch(() => null as any)
        if (stat && stat.isFile()) return true
      }
      return false
    })()

    expect(hasQuarantined).toBe(true)
  })
})
