import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { isInteractive } from "../../src/util/interactive"

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

describe("isInteractive", () => {
  beforeEach(() => {
    saveEnv("OPENCODE_FORCE_INTERACTIVE", "CI", "OPENCODE_CLIENT")
    clearEnv("OPENCODE_FORCE_INTERACTIVE", "CI", "OPENCODE_CLIENT")
  })

  afterEach(() => {
    restoreEnv()
  })

  test("returns true when OPENCODE_FORCE_INTERACTIVE=true", () => {
    process.env["OPENCODE_FORCE_INTERACTIVE"] = "true"
    process.env["CI"] = "true" // Should be overridden
    expect(isInteractive()).toBe(true)
  })

  test("returns false when CI=true", () => {
    process.env["CI"] = "true"
    expect(isInteractive()).toBe(false)
  })

  test("returns false when CI=1", () => {
    process.env["CI"] = "1"
    expect(isInteractive()).toBe(false)
  })

  test("returns false when CI=TRUE (case insensitive)", () => {
    process.env["CI"] = "TRUE"
    expect(isInteractive()).toBe(false)
  })

  test("returns false when CI=True (case insensitive)", () => {
    process.env["CI"] = "True"
    expect(isInteractive()).toBe(false)
  })

  test("returns true when OPENCODE_CLIENT=desktop", () => {
    process.env["OPENCODE_CLIENT"] = "desktop"
    expect(isInteractive()).toBe(true)
  })

  test("returns true when OPENCODE_CLIENT=vscode", () => {
    process.env["OPENCODE_CLIENT"] = "vscode"
    expect(isInteractive()).toBe(true)
  })

  test("falls through to TTY check when OPENCODE_CLIENT=cli", () => {
    process.env["OPENCODE_CLIENT"] = "cli"
    const expected = process.stdin.isTTY === true && process.stdout.isTTY === true
    expect(isInteractive()).toBe(expected)
  })

  test("falls through to TTY check when no env vars set", () => {
    const expected = process.stdin.isTTY === true && process.stdout.isTTY === true
    expect(isInteractive()).toBe(expected)
  })
})
