import { describe, test, expect, beforeEach, afterEach } from "bun:test"

// Store original env values
const originalEnv: Record<string, string | undefined> = {}

function saveEnv(...keys: string[]) {
  for (const key of keys) {
    originalEnv[key] = process.env[key]
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearEnv(...keys: string[]) {
  for (const key of keys) {
    delete process.env[key]
  }
}

// Dynamic import to get fresh module state
async function getIsInteractive() {
  // Clear module cache to get fresh evaluation
  const path = "../../src/util/interactive"
  delete require.cache[require.resolve(path)]
  const { isInteractive } = await import(path)
  return isInteractive
}

describe("isInteractive", () => {
  beforeEach(() => {
    saveEnv("OPENCODE_FORCE_INTERACTIVE", "CI", "OPENCODE_CLIENT")
    clearEnv("OPENCODE_FORCE_INTERACTIVE", "CI", "OPENCODE_CLIENT")
  })

  afterEach(() => {
    restoreEnv()
  })

  test("returns true when OPENCODE_FORCE_INTERACTIVE=true", async () => {
    process.env["OPENCODE_FORCE_INTERACTIVE"] = "true"
    process.env["CI"] = "true" // Should be overridden
    const isInteractive = await getIsInteractive()
    expect(isInteractive()).toBe(true)
  })

  test("returns false when CI=true", async () => {
    process.env["CI"] = "true"
    const isInteractive = await getIsInteractive()
    expect(isInteractive()).toBe(false)
  })

  test("returns false when CI=1", async () => {
    process.env["CI"] = "1"
    const isInteractive = await getIsInteractive()
    expect(isInteractive()).toBe(false)
  })

  test("returns false when CI=TRUE (case insensitive)", async () => {
    process.env["CI"] = "TRUE"
    const isInteractive = await getIsInteractive()
    expect(isInteractive()).toBe(false)
  })

  test("returns false when CI=True (case insensitive)", async () => {
    process.env["CI"] = "True"
    const isInteractive = await getIsInteractive()
    expect(isInteractive()).toBe(false)
  })

  test("returns true when OPENCODE_CLIENT=desktop", async () => {
    process.env["OPENCODE_CLIENT"] = "desktop"
    const isInteractive = await getIsInteractive()
    expect(isInteractive()).toBe(true)
  })

  test("returns true when OPENCODE_CLIENT=vscode", async () => {
    process.env["OPENCODE_CLIENT"] = "vscode"
    const isInteractive = await getIsInteractive()
    expect(isInteractive()).toBe(true)
  })

  test("falls through to TTY check when OPENCODE_CLIENT=cli", async () => {
    process.env["OPENCODE_CLIENT"] = "cli"
    const isInteractive = await getIsInteractive()
    // In test environment, TTY is typically false
    const expected = process.stdin.isTTY === true && process.stdout.isTTY === true
    expect(isInteractive()).toBe(expected)
  })

  test("falls through to TTY check when no env vars set", async () => {
    const isInteractive = await getIsInteractive()
    const expected = process.stdin.isTTY === true && process.stdout.isTTY === true
    expect(isInteractive()).toBe(expected)
  })
})
