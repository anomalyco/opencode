import { describe, expect, test } from "bun:test"
import { toggleMcp } from "./mcp"

describe("toggleMcp", () => {
  test("runs the status action before refreshing the owning queries", async () => {
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
      refreshStatus: async () => {
        calls.push("refresh-status")
      },
      refreshResources: async () => {
        calls.push("refresh-resources")
      },
    })

    await toggleMcp(input("connected"))
    expect(calls).toEqual(["disconnect", "refresh-status", "refresh-resources"])

    calls.length = 0
    await toggleMcp(input("needs_auth"))
    expect(calls).toEqual(["authenticate", "refresh-status", "refresh-resources"])

    calls.length = 0
    await toggleMcp(input("disabled"))
    expect(calls).toEqual(["connect", "refresh-status", "refresh-resources"])
  })

  test("does not toggle a server while its connection is pending", async () => {
    const calls: string[] = []
    await toggleMcp({
      status: "pending",
      connect: async () => {
        calls.push("connect")
      },
      disconnect: async () => {
        calls.push("disconnect")
      },
      authenticate: async () => {
        calls.push("authenticate")
      },
      refreshStatus: async () => {
        calls.push("refresh-status")
      },
      refreshResources: async () => {
        calls.push("refresh-resources")
      },
    })
    expect(calls).toEqual([])
  })

  test("does not wait for resource discovery", async () => {
    let releaseResources: () => void = () => undefined
    let resourcesStarted = false
    const resources = new Promise<void>((resolve) => {
      releaseResources = resolve
    })

    await toggleMcp({
      status: "disabled",
      connect: async () => undefined,
      disconnect: async () => undefined,
      authenticate: async () => undefined,
      refreshStatus: async () => undefined,
      refreshResources: async () => {
        resourcesStarted = true
        await resources
      },
    })

    expect(resourcesStarted).toBe(true)
    releaseResources()
  })

  test("ignores resource discovery failures", async () => {
    await expect(
      toggleMcp({
        status: "disabled",
        connect: async () => undefined,
        disconnect: async () => undefined,
        authenticate: async () => undefined,
        refreshStatus: async () => undefined,
        refreshResources: async () => {
          throw new Error("resources/list is unsupported")
        },
      }),
    ).resolves.toBeUndefined()
  })
})
