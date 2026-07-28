import { describe, expect, test } from "bun:test"
import { hasServiceNeedingAttention, serverStatusDotClass } from "./status-popover-indicator"

describe("serverStatusDotClass", () => {
  test("uses the success token while the server and services are healthy", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: true, issue: false })).toBe("bg-icon-success-base")
  })

  test("uses the session attention token when a service needs attention", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: true, issue: true })).toBe("bg-v2-background-bg-accent")
  })

  test("uses the critical token only after the server connection drops", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: false, issue: false })).toBe("bg-icon-critical-base")
    expect(serverStatusDotClass({ ready: true, serverHealth: false, issue: true })).toBe("bg-icon-critical-base")
  })

  test("stays neutral before status is ready", () => {
    expect(serverStatusDotClass({ ready: false, serverHealth: true, issue: false })).toBe("bg-border-weak-base")
    expect(serverStatusDotClass({ ready: false, serverHealth: undefined, issue: false })).toBe("bg-border-weak-base")
  })
})

describe("hasServiceNeedingAttention", () => {
  test("detects MCP states that need user attention", () => {
    expect(hasServiceNeedingAttention({ mcp: ["needs_auth"] })).toBe(true)
    expect(hasServiceNeedingAttention({ mcp: ["needs_client_registration"] })).toBe(true)
  })

  test("ignores states that do not need user attention", () => {
    expect(hasServiceNeedingAttention({ mcp: ["failed"] })).toBe(false)
    expect(hasServiceNeedingAttention({ mcp: ["connected", "pending", "disabled"] })).toBe(false)
  })
})
