import { describe, expect, test } from "bun:test"
import { toggleMcp } from "./mcp"

describe("toggleMcp", () => {
  test("runs the status action before refreshing the owning query", async () => {
    const calls: string[] = []
    const input = (status: "connected" | "needs_auth" | "disabled") => ({
      status,
      connect: async () => {
        calls.push("connect")
      },
      disconnect: async () => {
        calls.push("disconnect")
      },
      authenticate: async () => {
        calls.push("authenticate")
      },
      refresh: async () => {
        calls.push("refresh")
      },
    })

    await toggleMcp(input("connected"))
    expect(calls).toEqual(["disconnect", "refresh"])

    calls.length = 0
    await toggleMcp(input("needs_auth"))
    expect(calls).toEqual(["authenticate", "refresh"])

    calls.length = 0
    await toggleMcp(input("disabled"))
    expect(calls).toEqual(["connect", "refresh"])
  })
})
