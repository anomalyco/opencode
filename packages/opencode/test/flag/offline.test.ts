import { describe, test, expect, beforeEach, afterEach } from "bun:test"

describe("offline flag", () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {
      OPENCODE_OFFLINE: process.env["OPENCODE_OFFLINE"],
      OPENCODE_DISABLE_AUTOUPDATE: process.env["OPENCODE_DISABLE_AUTOUPDATE"],
      OPENCODE_DISABLE_SHARE: process.env["OPENCODE_DISABLE_SHARE"],
      OPENCODE_DISABLE_APP_PROXY: process.env["OPENCODE_DISABLE_APP_PROXY"],
    }
    delete process.env["OPENCODE_OFFLINE"]
    delete process.env["OPENCODE_DISABLE_AUTOUPDATE"]
    delete process.env["OPENCODE_DISABLE_SHARE"]
    delete process.env["OPENCODE_DISABLE_APP_PROXY"]
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  test("OPENCODE_OFFLINE=true enables all offline flags", async () => {
    process.env["OPENCODE_OFFLINE"] = "true"
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.OPENCODE_OFFLINE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_SHARE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_APP_PROXY).toBe(true)
  })

  test("OPENCODE_OFFLINE=1 enables all offline flags", async () => {
    process.env["OPENCODE_OFFLINE"] = "1"
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.OPENCODE_OFFLINE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_SHARE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_APP_PROXY).toBe(true)
  })

  test("without OPENCODE_OFFLINE, flags are false by default", async () => {
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.OPENCODE_OFFLINE).toBe(false)
    expect(Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe(false)
    expect(Flag.OPENCODE_DISABLE_SHARE).toBe(false)
    expect(Flag.OPENCODE_DISABLE_APP_PROXY).toBe(false)
  })

  test("granular flags work independently without OPENCODE_OFFLINE", async () => {
    process.env["OPENCODE_DISABLE_AUTOUPDATE"] = "true"
    process.env["OPENCODE_DISABLE_SHARE"] = "true"
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.OPENCODE_OFFLINE).toBe(false)
    expect(Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_SHARE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_APP_PROXY).toBe(false)
  })

  test("flags are dynamic — setting env at runtime changes their value", async () => {
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.OPENCODE_OFFLINE).toBe(false)
    process.env["OPENCODE_OFFLINE"] = "true"
    expect(Flag.OPENCODE_OFFLINE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe(true)
    expect(Flag.OPENCODE_DISABLE_SHARE).toBe(true)
    delete process.env["OPENCODE_OFFLINE"]
    expect(Flag.OPENCODE_OFFLINE).toBe(false)
    expect(Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe(false)
  })
})
