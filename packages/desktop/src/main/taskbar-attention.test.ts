import { describe, expect, test } from "bun:test"
import { createTaskbarAttentionRegistry } from "./taskbar-attention"

describe("taskbar badge count", () => {
  test("counts distinct sessions across windows", () => {
    const registry = createTaskbarAttentionRegistry()
    registry.set(1, ["server-a\0session-1", "server-a\0session-2"])
    registry.set(2, ["server-a\0session-2", "server-b\0session-3"])
    expect(registry.count()).toBe(3)
  })

  test("suppresses stale windows until all acknowledge a viewed session", () => {
    const registry = createTaskbarAttentionRegistry()
    registry.set(1, ["server-a\0session-1"])
    registry.set(2, ["server-a\0session-1"])

    registry.viewed("server-a\0session-1")
    registry.set(2, ["server-a\0session-1"])
    expect(registry.count()).toBe(0)

    registry.set(1, [])
    registry.set(2, [])
    registry.set(2, ["server-a\0session-1"])
    expect(registry.count()).toBe(1)
  })

  test("cleans closed windows", () => {
    const registry = createTaskbarAttentionRegistry()
    registry.set(1, ["server-a\0session-1"])
    registry.close(1)
    expect(registry.count()).toBe(0)
  })

  test("acknowledges stale sessions from windows opened during suppression", () => {
    const registry = createTaskbarAttentionRegistry()
    registry.set(1, ["server-a\0session-1"])
    registry.viewed("server-a\0session-1")

    expect(registry.set(2, ["server-a\0session-1"])).toEqual(["server-a\0session-1"])
    expect(registry.count()).toBe(0)

    registry.set(1, [])
    registry.set(2, [])
    registry.set(2, ["server-a\0session-1"])
    expect(registry.count()).toBe(1)
  })

  test("tracks windows that are still loading when a session is viewed", () => {
    const registry = createTaskbarAttentionRegistry()
    registry.set(1, ["server-a\0session-1"])
    registry.open(2)
    registry.viewed("server-a\0session-1")

    registry.set(1, [])
    expect(registry.set(2, ["server-a\0session-1"])).toEqual(["server-a\0session-1"])
    expect(registry.count()).toBe(0)

    registry.set(2, [])
    registry.set(2, ["server-a\0session-1"])
    expect(registry.count()).toBe(1)
  })
})
