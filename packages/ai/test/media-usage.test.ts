import { describe, expect, test } from "bun:test"
import { tokenUsage } from "../src/schema/index.js"

describe("tokenUsage", () => {
  test("is undefined when the provider reported no counts", () => {
    expect(tokenUsage({ details: { openrouter: {} } })).toBeUndefined()
  })

  test("keeps whatever counts were reported", () => {
    expect(tokenUsage({ output: 12 })).toEqual({ type: "tokens", output: 12 })
    expect(tokenUsage({ input: 3, output: 12, total: 15 })).toEqual({ type: "tokens", input: 3, output: 12, total: 15 })
  })
})
