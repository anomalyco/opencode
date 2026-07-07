import { expect, test } from "bun:test"
import { isOpenCodeEvent } from "../src/groups/event.js"

test("classifies public events by type", () => {
  expect(isOpenCodeEvent({ type: "server.connected" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.status.changed" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.resources.changed" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.tools.changed" })).toBe(false)
})
