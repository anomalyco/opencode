import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Storage } from "../../src/storage/storage"
import { Global } from "../../src/global"

function storageDir() {
  return path.join(Global.Path.data, "storage")
}

describe("storage.repair", () => {
  test("quarantines invalid JSON files and removes temp files", async () => {
    const dir = storageDir()

    const badFile = path.join(dir, "test", "invalid", "bad.json")
    await fs.mkdir(path.dirname(badFile), { recursive: true })
    await fs.writeFile(badFile, "{invalid")

    const tmpLeftover = path.join(dir, "leftovers", `.oc-foo.json.${process.pid}.${Date.now()}.tmp`)
    await fs.mkdir(path.dirname(tmpLeftover), { recursive: true })
    await fs.writeFile(tmpLeftover, "tmp")

    const result = await Storage.repair()

    expect(result.quarantined).toBeGreaterThanOrEqual(1)
    expect(result.tempRemoved).toBeGreaterThanOrEqual(1)

    await expect(fs.access(badFile)).rejects.toBeDefined()
    await expect(fs.access(tmpLeftover)).rejects.toBeDefined()

    const quarantinedBad = path.join(result.quarantineRoot, "test", "invalid", "bad.json")
    const stat = await fs.stat(quarantinedBad)
    expect(stat.isFile()).toBe(true)

    const report = JSON.parse(await Bun.file(result.reportPath!).text())
    expect(Array.isArray(report.entries)).toBe(true)
  })

  test("write/read roundtrip remains valid", async () => {
    const key = ["roundtrip", "item"]
    const content = { a: 1 }
    await Storage.write(key, content)
    const out = await Storage.read<typeof content>(key)
    expect(out).toEqual(content)
  })

  test("repair dry-run reports but does not modify", async () => {
    const dir = storageDir()
    const badFile = path.join(dir, "test", "dryrun", "bad.json")
    await fs.mkdir(path.dirname(badFile), { recursive: true })
    await fs.writeFile(badFile, "{invalid")

    const result = await Storage.repair({ dryRun: true })
    expect(result.quarantined).toBeGreaterThanOrEqual(1)
    await expect(fs.stat(badFile)).resolves.toBeDefined()
  })

  test("restore moves back quarantined files", async () => {
    const dir = storageDir()
    const badFile = path.join(dir, "test", "restore", "bad.json")
    await fs.mkdir(path.dirname(badFile), { recursive: true })
    await fs.writeFile(badFile, "{invalid")

    const r = await Storage.repair()
    const quarantinedBad = path.join(r.quarantineRoot, "test", "restore", "bad.json")
    await expect(fs.stat(quarantinedBad)).resolves.toBeDefined()

    const restored = await Storage.restore({ path: r.quarantineRoot })
    expect(restored.restored).toBeGreaterThanOrEqual(1)
    await expect(fs.stat(path.join(dir, "test", "restore", "bad.json"))).resolves.toBeDefined()
  })
})
