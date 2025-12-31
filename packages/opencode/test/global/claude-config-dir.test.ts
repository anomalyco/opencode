import { test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import path from "path"
import { mkdir } from "fs/promises"

let originalClaudeConfigDir: string | undefined
let originalTestHome: string | undefined
let originalXdgConfigHome: string | undefined

beforeEach(() => {
  originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalTestHome = process.env.OPENCODE_TEST_HOME
  originalXdgConfigHome = process.env.XDG_CONFIG_HOME
})

afterEach(() => {
  if (originalClaudeConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  if (originalTestHome !== undefined) {
    process.env.OPENCODE_TEST_HOME = originalTestHome
  } else {
    delete process.env.OPENCODE_TEST_HOME
  }
  if (originalXdgConfigHome !== undefined) {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome
  } else {
    delete process.env.XDG_CONFIG_HOME
  }
})

test("returns CLAUDE_CONFIG_DIR when set to valid directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await mkdir(path.join(dir, "custom-claude-config"), { recursive: true })
    },
  })

  const customDir = path.join(tmp.path, "custom-claude-config")
  process.env.CLAUDE_CONFIG_DIR = customDir
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBe(customDir)
})

test("falls back when CLAUDE_CONFIG_DIR path does not exist", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  process.env.CLAUDE_CONFIG_DIR = path.join(tmp.path, "non-existent-dir")
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBe(path.join(tmp.path, ".claude"))
})

test("falls back when CLAUDE_CONFIG_DIR is a file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "claude-file"), "not a directory")
      await mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  process.env.CLAUDE_CONFIG_DIR = path.join(tmp.path, "claude-file")
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBe(path.join(tmp.path, ".claude"))
})

test("returns xdg path when CLAUDE_CONFIG_DIR not set", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await mkdir(path.join(dir, ".config", "claude"), { recursive: true })
      await mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  delete process.env.CLAUDE_CONFIG_DIR
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBe(path.join(tmp.path, ".config", "claude"))
})

test("returns legacy path when only it exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  delete process.env.CLAUDE_CONFIG_DIR
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBe(path.join(tmp.path, ".claude"))
})

test("returns undefined when no paths exist", async () => {
  await using tmp = await tmpdir()

  delete process.env.CLAUDE_CONFIG_DIR
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBeUndefined()
})

test("returns undefined when CLAUDE_CONFIG_DIR is empty string", async () => {
  await using tmp = await tmpdir()

  process.env.CLAUDE_CONFIG_DIR = ""
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBeUndefined()
})

test("priority: CLAUDE_CONFIG_DIR > XDG > legacy", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await mkdir(path.join(dir, "custom"), { recursive: true })
      await mkdir(path.join(dir, ".config", "claude"), { recursive: true })
      await mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  const customDir = path.join(tmp.path, "custom")
  process.env.CLAUDE_CONFIG_DIR = customDir
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

  expect(await Global.claudeConfigDir()).toBe(customDir)
})
