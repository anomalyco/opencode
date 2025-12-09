import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Ripgrep } from "../../src/file/ripgrep"

describe("Ripgrep.files", () => {
  test("honors ignore globs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rg-files-"))
    const keep = path.join(dir, "keep.txt")
    const skipDir = path.join(dir, "node_modules")
    const skipFile = path.join(skipDir, "ignore.txt")

    await fs.writeFile(keep, "ok")
    await fs.mkdir(skipDir)
    await fs.writeFile(skipFile, "skip")

    const files = await Array.fromAsync(
      Ripgrep.files({ cwd: dir, ignore: ["**/node_modules/**"] }),
    )

    expect(files.some((f) => f.endsWith("keep.txt"))).toBe(true)
    expect(files.some((f) => f.includes("node_modules"))).toBe(false)

    await fs.rm(dir, { recursive: true, force: true })
  })

  test("respects max depth", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rg-depth-"))
    const deepDir = path.join(dir, "a", "b", "c")
    await fs.mkdir(deepDir, { recursive: true })
    await fs.writeFile(path.join(dir, "root.txt"), "root")
    await fs.writeFile(path.join(deepDir, "deep.txt"), "deep")

    const files = await Array.fromAsync(Ripgrep.files({ cwd: dir, maxDepth: 2 }))

    expect(files.some((f) => f.endsWith("root.txt"))).toBe(true)
    expect(files.some((f) => f.endsWith("deep.txt"))).toBe(false)

    await fs.rm(dir, { recursive: true, force: true })
  })
})
