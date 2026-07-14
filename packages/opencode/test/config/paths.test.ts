import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigPaths } from "../../src/config/paths"

describe("ConfigPaths writable helpers", () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  async function tmp() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kancode-paths-"))
    dirs.push(dir)
    return dir
  }

  test("resolveWritableConfigFile prefers existing kancode.json", async () => {
    const dir = await tmp()
    await Bun.write(path.join(dir, "opencode.json"), "{}")
    await Bun.write(path.join(dir, "kancode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir)).toBe(path.join(dir, "kancode.json"))
  })

  test("resolveWritableConfigFile falls back to opencode.json then defaults to kancode.json", async () => {
    const dir = await tmp()
    expect(ConfigPaths.resolveWritableConfigFile(dir)).toBe(path.join(dir, "kancode.json"))
    await Bun.write(path.join(dir, "opencode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir)).toBe(path.join(dir, "opencode.json"))
  })

  test("resolveWritableConfigFile project scope checks .kancode then .opencode", async () => {
    const dir = await tmp()
    await fs.mkdir(path.join(dir, ".opencode"))
    await Bun.write(path.join(dir, ".opencode", "opencode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir, { project: true })).toBe(
      path.join(dir, ".opencode", "opencode.json"),
    )

    await fs.mkdir(path.join(dir, ".kancode"))
    await Bun.write(path.join(dir, ".kancode", "kancode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir, { project: true })).toBe(
      path.join(dir, ".kancode", "kancode.json"),
    )
  })

  test("resolveWritableProjectDir prefers .kancode, reuses .opencode, else creates .kancode", async () => {
    const empty = await tmp()
    expect(ConfigPaths.resolveWritableProjectDir(empty)).toBe(path.join(empty, ".kancode"))

    const legacy = await tmp()
    await fs.mkdir(path.join(legacy, ".opencode"))
    expect(ConfigPaths.resolveWritableProjectDir(legacy)).toBe(path.join(legacy, ".opencode"))

    const both = await tmp()
    await fs.mkdir(path.join(both, ".opencode"))
    await fs.mkdir(path.join(both, ".kancode"))
    expect(ConfigPaths.resolveWritableProjectDir(both)).toBe(path.join(both, ".kancode"))
  })
})
