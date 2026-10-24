import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { pollWith, scanDirectory, scanEntries, Watcher } from "@opencode/core/filesystem/watcher"
import { tmpdir } from "../fixture/tmpdir"

function createEvent(predicate: (update: Watcher.Update) => boolean) {
  let resolve!: (update: Watcher.Update) => void
  const matched = new Promise<Watcher.Update>((done) => (resolve = done))
  return {
    matched,
    publish(update: Watcher.Update) {
      if (predicate(update)) resolve(update)
    },
  }
}

describe("watcher poll fallback", () => {
  test("reports a file in a folder that does not exist yet", async () => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "missing")
    const file = path.join(directory, "created.txt")
    const created = createEvent((update) => update.path === file && update.type === "create")

    const subscription = await pollWith(
      scanEntries(directory, new Set([path.basename(file)])),
      10,
      created.publish,
    )

    try {
      await fs.mkdir(directory)
      await fs.writeFile(file, "x")
      await expect(created.matched).resolves.toEqual({ path: file, type: "create" })
    } finally {
      await subscription.unsubscribe()
    }
  })

  test("watches a directory and skips configured folders", async () => {
    await using tmp = await tmpdir()
    const skills = path.join(tmp.path, "skills")
    const ignored = path.join(tmp.path, "node_modules")
    await fs.mkdir(skills, { recursive: true })
    await fs.mkdir(ignored, { recursive: true })
    await fs.writeFile(path.join(skills, "existing.md"), "old")
    await fs.writeFile(path.join(ignored, "existing.txt"), "old")

    const scan = scanDirectory(tmp.path, ["node_modules"])
    const before = await scan()
    expect(before.has(path.join(skills, "existing.md"))).toBe(true)
    expect(before.has(path.join(ignored, "existing.txt"))).toBe(false)

    const file = path.join(skills, "new.md")
    const created = createEvent((update) => update.path === file && update.type === "create")
    const subscription = await pollWith(scan, 10, created.publish)

    try {
      await fs.writeFile(file, "x")
      await expect(created.matched).resolves.toEqual({ path: file, type: "create" })

      const late = path.join(ignored, "late.txt")
      await fs.writeFile(late, "x")
      const after = await scan()
      expect(after.has(file)).toBe(true)
      expect(after.has(late)).toBe(false)
    } finally {
      await subscription.unsubscribe()
    }
  })
})
