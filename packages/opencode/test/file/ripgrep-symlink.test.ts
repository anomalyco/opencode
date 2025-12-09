import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Ripgrep } from "../../src/file/ripgrep"

// Ensure ripgrep listing does not hang on symlink loops when follow=false
describe("Ripgrep.files symlink safety", () => {
  test("skips symlink loop by default", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rg-loop-"))
    const target = path.join(dir, "target")
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, "file.txt"), "ok")
    // loop -> parent (creates cycle target/loop/target/...)
    await fs.symlink(target, path.join(target, "loop"))

    const files = await Array.fromAsync(Ripgrep.files({ cwd: dir }))

    expect(files.some((f) => f.endsWith("file.txt"))).toBe(true)
    expect(files.some((f) => f.includes("loop"))).toBe(false)

    await fs.rm(dir, { recursive: true, force: true })
  })
})
