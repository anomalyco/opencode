import { afterEach, describe, expect, test } from "bun:test"
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
})

const original = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  process.env.CLAUDE_CONFIG_DIR = original
})

describe("Global.claudeConfigDir", () => {
  test("defaults to .claude under the home directory", () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const global = Global.make({ home: "/home/test" })
    expect(global.claudeConfigDir).toBe(path.join("/home/test", ".claude"))
  })

  test("respects CLAUDE_CONFIG_DIR when set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/claude"
    const global = Global.make({ home: "/home/test" })
    expect(global.claudeConfigDir).toBe("/custom/claude")
  })

  test("treats empty CLAUDE_CONFIG_DIR as unset", () => {
    process.env.CLAUDE_CONFIG_DIR = ""
    const global = Global.make({ home: "/home/test" })
    expect(global.claudeConfigDir).toBe(path.join("/home/test", ".claude"))
  })

  test("explicit input wins over CLAUDE_CONFIG_DIR", () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/claude"
    const global = Global.make({ claudeConfigDir: "/explicit" })
    expect(global.claudeConfigDir).toBe("/explicit")
  })
})
