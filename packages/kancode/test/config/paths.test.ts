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

  test("resolveWritableConfigFile user scope prefers kancode.json and ignores opencode.json", async () => {
    const dir = await tmp()
    await Bun.write(path.join(dir, "opencode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir)).toBe(path.join(dir, "kancode.json"))
    await Bun.write(path.join(dir, "kancode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir)).toBe(path.join(dir, "kancode.json"))
  })

  test("resolveWritableConfigFile user scope defaults to kancode.json", async () => {
    const dir = await tmp()
    expect(ConfigPaths.resolveWritableConfigFile(dir)).toBe(path.join(dir, "kancode.json"))
  })

  test("resolveWritableConfigFile project scope uses .kancode only", async () => {
    const dir = await tmp()
    await fs.mkdir(path.join(dir, ".opencode"))
    await Bun.write(path.join(dir, ".opencode", "kancode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir, { project: true })).toBe(path.join(dir, "kancode.json"))

    await fs.mkdir(path.join(dir, ".kancode"))
    await Bun.write(path.join(dir, ".kancode", "kancode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir, { project: true })).toBe(
      path.join(dir, ".kancode", "kancode.json"),
    )
  })

  test("resolveWritableConfigFile project scope ignores opencode.json at root", async () => {
    const dir = await tmp()
    await Bun.write(path.join(dir, "opencode.json"), "{}")
    expect(ConfigPaths.resolveWritableConfigFile(dir, { project: true })).toBe(path.join(dir, "kancode.json"))
  })

  test("resolveWritableProjectDir always returns .kancode", async () => {
    const empty = await tmp()
    expect(ConfigPaths.resolveWritableProjectDir(empty)).toBe(path.join(empty, ".kancode"))

    const legacy = await tmp()
    await fs.mkdir(path.join(legacy, ".opencode"))
    expect(ConfigPaths.resolveWritableProjectDir(legacy)).toBe(path.join(legacy, ".kancode"))

    const both = await tmp()
    await fs.mkdir(path.join(both, ".opencode"))
    await fs.mkdir(path.join(both, ".kancode"))
    expect(ConfigPaths.resolveWritableProjectDir(both)).toBe(path.join(both, ".kancode"))
  })

  test("preferredUserConfigFile ignores opencode.json", async () => {
    const dir = await tmp()
    await Bun.write(path.join(dir, "opencode.json"), "{}")
    expect(ConfigPaths.preferredUserConfigFile(dir)).toBeUndefined()
    await Bun.write(path.join(dir, "kancode.json"), "{}")
    expect(ConfigPaths.preferredUserConfigFile(dir)).toBe(path.join(dir, "kancode.json"))
  })

  test("projectConfigFilesInDirectory loads KanCode only", async () => {
    const dir = await tmp()
    await Bun.write(path.join(dir, "opencode.json"), "{}")
    expect(ConfigPaths.projectConfigFilesInDirectory(dir)).toEqual([])

    await Bun.write(path.join(dir, "kancode.json"), "{}")
    expect(ConfigPaths.projectConfigFilesInDirectory(dir)).toEqual([path.join(dir, "kancode.json")])

    await Bun.write(path.join(dir, "kancode.jsonc"), "{}")
    await Bun.write(path.join(dir, "opencode.jsonc"), "{}")
    expect(ConfigPaths.projectConfigFilesInDirectory(dir)).toEqual([path.join(dir, "kancode.jsonc")])
  })

  test("PROJECT_DIR_TARGETS is .kancode only", () => {
    expect(ConfigPaths.PROJECT_DIR_TARGETS).toEqual([".kancode"])
  })

  test("isProjectConfigDir rejects .opencode", () => {
    expect(ConfigPaths.isProjectConfigDir("/repo/.kancode")).toBe(true)
    expect(ConfigPaths.isProjectConfigDir("/repo/.opencode")).toBe(false)
  })
})
