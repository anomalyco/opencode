import { describe, expect, test } from "bun:test"
import { canTileSessionTabs, tabOrderKey, type TabOrderItem } from "./tabs-order"

const sessionTab = (sessionId: string): TabOrderItem => ({
  type: "session",
  server: "sidecar",
  sessionId,
})

describe("tabOrderKey", () => {
  test("keys session tabs by server and session id", () => {
    expect(tabOrderKey(sessionTab("first"))).toBe("sidecar\nfirst")
  })
})

describe("canTileSessionTabs", () => {
  test("allows only the bounded desktop panel range", () => {
    expect(canTileSessionTabs(1)).toBe(false)
    expect(canTileSessionTabs(2)).toBe(true)
    expect(canTileSessionTabs(4)).toBe(true)
    expect(canTileSessionTabs(5)).toBe(false)
  })
})
