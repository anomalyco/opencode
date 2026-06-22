import { describe, expect, test } from "bun:test"
import { createMockWslServers } from "./mock"

describe("createMockWslServers", () => {
  test("returns onboarding state for onboarding scenario", async () => {
    const api = createMockWslServers("onboarding")
    const state = await api.getState()
    expect(state.runtime?.available).toBe(false)
    expect(state.servers).toEqual([])
  })

  test("adds a server after startup delay", async () => {
    const api = createMockWslServers("fresh")
    const config = await api.addServer("Ubuntu-24.04")
    expect(config.id).toBe("wsl:Ubuntu-24.04")
    const ready = await api.getState()
    expect(ready.servers.some((item) => item.config.id === config.id && item.runtime.kind === "ready")).toBe(true)
  })

  test("notifies subscribers when state changes", async () => {
    const api = createMockWslServers("onboarding")
    let count = 0
    api.subscribe(() => {
      count++
    })
    await api.probeRuntime()
    expect(count).toBeGreaterThan(1)
  })
})
