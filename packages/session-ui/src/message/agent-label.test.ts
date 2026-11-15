import { expect, test } from "bun:test"
import { agentLabel } from "./agent-label"

test("capitalizes the agent when agents are visible", () => {
  expect(agentLabel("build", true)).toBe("Build")
})

test("omits the agent when agents are hidden or missing", () => {
  expect(agentLabel("build", false)).toBe("")
  expect(agentLabel(undefined, true)).toBe("")
})
