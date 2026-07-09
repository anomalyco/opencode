import { expect, test } from "bun:test"
import { matches } from "../src/frontend/actions"

test("matches literal screen text", () => {
  const harness = { screen: () => "OpenCode [ready].*" }

  expect(matches(harness, "OpenCode")).toBe(true)
  expect(matches(harness, "[ready].*")).toBe(true)
  expect(matches(harness, "OpenCode.*ready")).toBe(false)
  expect(matches(harness, "opencode")).toBe(false)
})
