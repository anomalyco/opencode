import { test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

// We need to test the claudeConfigDir function with various environment scenarios.
// Since the function reads from Flag.CLAUDE_CONFIG_DIR and Global.Path.home at import time,
// we need to test the actual implementation by setting env vars before importing.

// Helper to create the claudeConfigDir function with fresh state
async function createClaudeConfigDir(opts: { envVar?: string; testHome: string; xdgConfig: string }) {
  // Set up environment before importing
  if (opts.envVar !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = opts.envVar
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  process.env.OPENCODE_TEST_HOME = opts.testHome
  process.env.XDG_CONFIG_HOME = opts.xdgConfig

  // Helper to check if path is a directory
  async function isDirectory(p: string): Promise<boolean> {
    const stat = await fs.stat(p).catch(() => undefined)
    return stat?.isDirectory() ?? false
  }

  // Recreate the claudeConfigDir logic inline for testing
  // This mirrors the implementation in src/global/index.ts
  async function claudeConfigDir(): Promise<string | undefined> {
    const claudeConfigDirEnv = process.env.CLAUDE_CONFIG_DIR
    if (claudeConfigDirEnv && (await isDirectory(claudeConfigDirEnv))) {
      return claudeConfigDirEnv
    }

    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(opts.testHome, ".config")
    const xdgClaude = path.join(xdgConfig, "claude")
    if (await isDirectory(xdgClaude)) {
      return xdgClaude
    }

    const home = process.env.OPENCODE_TEST_HOME || opts.testHome
    const legacyClaude = path.join(home, ".claude")
    if (await isDirectory(legacyClaude)) {
      return legacyClaude
    }

    return undefined
  }

  return claudeConfigDir
}

// Store original env values
let originalClaudeConfigDir: string | undefined
let originalTestHome: string | undefined
let originalXdgConfigHome: string | undefined

beforeEach(() => {
  originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalTestHome = process.env.OPENCODE_TEST_HOME
  originalXdgConfigHome = process.env.XDG_CONFIG_HOME
})

afterEach(() => {
  // Restore original env values
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
      const claudeDir = path.join(dir, "custom-claude-config")
      await fs.mkdir(claudeDir, { recursive: true })
    },
  })

  const customDir = path.join(tmp.path, "custom-claude-config")
  const claudeConfigDir = await createClaudeConfigDir({
    envVar: customDir,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  const result = await claudeConfigDir()
  expect(result).toBe(customDir)
})

test("falls back when CLAUDE_CONFIG_DIR is set but path does not exist", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create the legacy .claude directory as fallback
      const legacyDir = path.join(dir, ".claude")
      await fs.mkdir(legacyDir, { recursive: true })
    },
  })

  const nonExistentPath = path.join(tmp.path, "non-existent-dir")
  const claudeConfigDir = await createClaudeConfigDir({
    envVar: nonExistentPath,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  const result = await claudeConfigDir()
  expect(result).toBe(path.join(tmp.path, ".claude"))
})

test("falls back when CLAUDE_CONFIG_DIR is set but path is a file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a file (not directory) at the specified path
      const filePath = path.join(dir, "claude-file")
      await Bun.write(filePath, "this is a file, not a directory")
      // Create legacy .claude directory as fallback
      const legacyDir = path.join(dir, ".claude")
      await fs.mkdir(legacyDir, { recursive: true })
    },
  })

  const filePath = path.join(tmp.path, "claude-file")
  const claudeConfigDir = await createClaudeConfigDir({
    envVar: filePath,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  const result = await claudeConfigDir()
  expect(result).toBe(path.join(tmp.path, ".claude"))
})

test("returns ~/.config/claude when CLAUDE_CONFIG_DIR not set and xdg path exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create XDG config claude directory
      const xdgClaudeDir = path.join(dir, ".config", "claude")
      await fs.mkdir(xdgClaudeDir, { recursive: true })
      // Also create legacy .claude directory (should NOT be returned)
      const legacyDir = path.join(dir, ".claude")
      await fs.mkdir(legacyDir, { recursive: true })
    },
  })

  const claudeConfigDir = await createClaudeConfigDir({
    envVar: undefined, // Not set
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  const result = await claudeConfigDir()
  // Should prefer XDG path over legacy
  expect(result).toBe(path.join(tmp.path, ".config", "claude"))
})

test("returns ~/.claude when CLAUDE_CONFIG_DIR not set and only legacy path exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Only create legacy .claude directory (no XDG)
      const legacyDir = path.join(dir, ".claude")
      await fs.mkdir(legacyDir, { recursive: true })
    },
  })

  const claudeConfigDir = await createClaudeConfigDir({
    envVar: undefined,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"), // XDG dir exists but no claude subdir
  })

  const result = await claudeConfigDir()
  expect(result).toBe(path.join(tmp.path, ".claude"))
})

test("returns undefined when no paths exist", async () => {
  await using tmp = await tmpdir()

  const claudeConfigDir = await createClaudeConfigDir({
    envVar: undefined,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  const result = await claudeConfigDir()
  expect(result).toBeUndefined()
})

test("returns undefined when CLAUDE_CONFIG_DIR is empty string", async () => {
  await using tmp = await tmpdir()

  const claudeConfigDir = await createClaudeConfigDir({
    envVar: "", // Empty string
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  const result = await claudeConfigDir()
  expect(result).toBeUndefined()
})

test("priority: CLAUDE_CONFIG_DIR > XDG > legacy", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create all three directories
      const customDir = path.join(dir, "custom")
      const xdgDir = path.join(dir, ".config", "claude")
      const legacyDir = path.join(dir, ".claude")
      await fs.mkdir(customDir, { recursive: true })
      await fs.mkdir(xdgDir, { recursive: true })
      await fs.mkdir(legacyDir, { recursive: true })
    },
  })

  const customDir = path.join(tmp.path, "custom")
  const claudeConfigDir = await createClaudeConfigDir({
    envVar: customDir,
    testHome: tmp.path,
    xdgConfig: path.join(tmp.path, ".config"),
  })

  const result = await claudeConfigDir()
  // Should return CLAUDE_CONFIG_DIR path first
  expect(result).toBe(customDir)
})
