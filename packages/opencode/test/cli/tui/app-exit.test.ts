import { describe, expect, test } from "bun:test"
import { shouldExit } from "../../../src/cli/cmd/tui/app-exit"

describe("shouldExit", () => {
  test("allows app exit on plugin routes", () => {
    expect(shouldExit("plugin")).toBe(true)
  })

  test("does not claim session routes", () => {
    expect(shouldExit("session")).toBe(false)
  })
})
