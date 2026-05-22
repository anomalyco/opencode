import { describe, expect, test } from "bun:test"
import { time } from "@/util/locale"

describe("locale", () => {
  const originalEnv = { ...process.env }

  test("respects LC_TIME for 24-hour locale", () => {
    process.env.LC_TIME = "da_DK.UTF-8"
    const result = time(Date.now())
    expect(result).not.toMatch(/AM|PM/i)
  })

  test("respects LC_TIME for 12-hour locale", () => {
    process.env.LC_TIME = "en_US.UTF-8"
    const result = time(Date.now())
    expect(result).toMatch(/AM|PM/i)
  })

  test("does not crash when no locale env vars set", () => {
    delete process.env.LC_ALL
    delete process.env.LC_TIME
    delete process.env.LANG
    const result = time(Date.now())
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)

    // Restore original env
    Object.assign(process.env, originalEnv)
  })
})
