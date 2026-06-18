import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  test("config directory env vars add extra config directories", () => {
    const previousDir = process.env.OPENCODE_CONFIG_DIR
    const previousDirs = process.env.OPENCODE_CONFIG_DIRS
    process.env.OPENCODE_CONFIG_DIR = "/tmp/opencode-extra-config"
    process.env.OPENCODE_CONFIG_DIRS = ["/tmp/opencode-extra-a", "/tmp/opencode-extra-b"].join(path.delimiter)
    try {
      const global = Global.make()

      expect(global.config).toBe(Global.Path.config)
      expect(global.extraConfigDirs).toEqual([
        "/tmp/opencode-extra-config",
        "/tmp/opencode-extra-a",
        "/tmp/opencode-extra-b",
      ])
    } finally {
      if (previousDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = previousDir
      if (previousDirs === undefined) delete process.env.OPENCODE_CONFIG_DIRS
      else process.env.OPENCODE_CONFIG_DIRS = previousDirs
    }
  })
})
