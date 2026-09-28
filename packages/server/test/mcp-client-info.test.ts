import { expect, test } from "bun:test"
import { mcpClientInfo } from "@opencode/server/routes"

test("mcp client info reports opencode even when app.name is the cli artifact", () => {
  expect(mcpClientInfo({ name: "cli", version: "1.2.3" })).toEqual({ name: "opencode", version: "1.2.3" })
})

test("mcp client info reports opencode when app is undefined", () => {
  expect(mcpClientInfo(undefined)).toEqual({ name: "opencode", version: "unknown" })
})

test("OPENCODE_CLIENT still overrides the mcp client name", () => {
  const previous = process.env.OPENCODE_CLIENT
  process.env.OPENCODE_CLIENT = "acp"
  try {
    expect(mcpClientInfo({ name: "cli", version: "1.0.0" }).name).toBe("acp")
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = previous
  }
})
