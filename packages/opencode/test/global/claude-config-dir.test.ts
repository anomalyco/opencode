import { test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

async function isDirectory(p: string): Promise<boolean> {
  const stat = await fs.stat(p).catch(() => undefined)
  return stat?.isDirectory() ?? false
}

function createClaudeConfigDir(opts: { envVar?: string; testHome: string; xdgConfig: string }) {
  if (opts.envVar !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = opts.envVar
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  process.env.OPENCODE_TEST_HOME = opts.testHome
  process.env.XDG_CONFIG_HOME = opts.xdgConfig

  return async function claudeConfigDir(): Promise<string | undefined> {
    const envDir = process.env.CLAUDE_CONFIG_DIR
    if (envDir && (await isDirectory(envDir))) return envDir

    const xdgPath = process.env.XDG_CONFIG_HOME || path.join(opts.testHome, ".config")
    const xdgClaude = path.join(xdgPath, "claude")
    if (await isDirectory(xdgClaude)) return xdgClaude

    const home = process.env.OPENCODE_TEST_HOME || opts.testHome
    const legacy = path.join(home, ".claude")
    if (await isDirectory(legacy)) return legacy

    return undefined
  }
}

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
      await fs.mkdir(path.join(dir, "custom-claude-config"), { recursive: true })
    },
  })

  const customDir = path.join(tmp.path, "custom-claude-config")
  const claudeConfigDir = createClaudeConfigDir({
    envVar: customDir,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBe(customDir)
})

test("falls back when CLAUDE_CONFIG_DIR path does not exist", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  const claudeConfigDir = createClaudeConfigDir({
    envVar: path.join(tmp.path, "non-existent-dir"),
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBe(path.join(tmp.path, ".claude"))
})

test("falls back when CLAUDE_CONFIG_DIR is a file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "claude-file"), "not a directory")
      await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  const claudeConfigDir = createClaudeConfigDir({
    envVar: path.join(tmp.path, "claude-file"),
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBe(path.join(tmp.path, ".claude"))
})

test("returns xdg path when CLAUDE_CONFIG_DIR not set", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".config", "claude"), { recursive: true })
      await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  const claudeConfigDir = createClaudeConfigDir({
    envVar: undefined,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBe(path.join(tmp.path, ".config", "claude"))
})

test("returns legacy path when only it exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  const claudeConfigDir = createClaudeConfigDir({
    envVar: undefined,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBe(path.join(tmp.path, ".claude"))
})

test("returns undefined when no paths exist", async () => {
  await using tmp = await tmpdir()

  const claudeConfigDir = createClaudeConfigDir({
    envVar: undefined,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBeUndefined()
})

test("returns undefined when CLAUDE_CONFIG_DIR is empty string", async () => {
  await using tmp = await tmpdir()

  const claudeConfigDir = createClaudeConfigDir({
    envVar: "",
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBeUndefined()
})

test("priority: CLAUDE_CONFIG_DIR > XDG > legacy", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "custom"), { recursive: true })
      await fs.mkdir(path.join(dir, ".config", "claude"), { recursive: true })
      await fs.mkdir(path.join(dir, ".claude"), { recursive: true })
    },
  })

  const customDir = path.join(tmp.path, "custom")
  const claudeConfigDir = createClaudeConfigDir({
    envVar: customDir,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  expect(await claudeConfigDir()).toBe(customDir)
})
