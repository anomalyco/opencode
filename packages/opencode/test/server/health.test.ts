import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { instructionCheck } from "../../src/server/health"

describe("instructionCheck", () => {
  let env: Record<string, string | undefined>

  beforeEach(() => {
    env = {
      UNIVER_SDK_WS: process.env["UNIVER_SDK_WS"],
      VERITLY_EXECUTOR_URL: process.env["VERITLY_EXECUTOR_URL"],
      VITE_UNIVER_SDK_WS: process.env["VITE_UNIVER_SDK_WS"],
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key]
        continue
      }
      process.env[key] = value
    }
  })

  test("passes when hosted executor instructions are present", () => {
    process.env["VERITLY_EXECUTOR_URL"] = "http://executor:7777"
    process.env["UNIVER_SDK_WS"] = "ws://relay:8080/ws"

    const result = instructionCheck()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain("executor/univer instructions present")
  })

  test("skips when hosted executor instructions are not needed", () => {
    delete process.env["UNIVER_SDK_WS"]
    delete process.env["VERITLY_EXECUTOR_URL"]
    delete process.env["VITE_UNIVER_SDK_WS"]

    const result = instructionCheck()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain("skipped")
  })
})
