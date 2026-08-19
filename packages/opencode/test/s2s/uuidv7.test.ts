import { describe, test, expect } from "bun:test"
import { uuidv7 } from "../../src/s2s/uuidv7"

describe("uuidv7", () => {
  test("is a valid v7 uuid (version nibble = 7)", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  test("is time-ordered (later id sorts after earlier)", async () => {
    const a = uuidv7()
    await new Promise((r) => setTimeout(r, 2))
    const b = uuidv7()
    expect(a < b).toBe(true)
  })
})
