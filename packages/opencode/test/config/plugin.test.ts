import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigPlugin } from "../../src/config/plugin"

describe("config.plugin.load", () => {
  test("loads directory plugins in lexicographic order", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-plugin-order-"))
    // Create out of order so a filesystem-order pass-through would fail.
    for (const name of ["10_b.ts", "00_a.ts", "05_c.ts"]) {
      await Bun.write(path.join(dir, "plugin", name), "export default async () => ({})\n")
    }

    const plugins = await ConfigPlugin.load(dir)
    const names = plugins.map((spec) => {
      const href = ConfigPlugin.pluginSpecifier(spec)
      return href.slice(href.lastIndexOf("/") + 1)
    })
    expect(names).toEqual(["00_a.ts", "05_c.ts", "10_b.ts"])

    await fs.rm(dir, { recursive: true, force: true })
  })
})
