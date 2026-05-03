import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { instructionCheck } from "../../src/server/health"

describe("instructionCheck", () => {
  let env: Record<string, string | undefined>

  beforeEach(() => {
    env = {
      UNIVER_SDK_WS: process.env["UNIVER_SDK_WS"],
      VITE_UNIVER_SDK_WS: process.env["VITE_UNIVER_SDK_WS"],
      PUBLIC_BASE_URL: process.env["PUBLIC_BASE_URL"],
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

  test("passes when hosted browser-python instructions are present", () => {
    process.env["PUBLIC_BASE_URL"] = "https://app.example.com"
    process.env["UNIVER_SDK_WS"] = "ws://relay:8080/ws"

    const result = instructionCheck()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain("pyodide / univer instructions present")
  })

  test("skips when hosted browser-python instructions are not needed", () => {
    delete process.env["UNIVER_SDK_WS"]
    delete process.env["VITE_UNIVER_SDK_WS"]
    delete process.env["PUBLIC_BASE_URL"]

    const result = instructionCheck()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain("skipped")
  })
})
