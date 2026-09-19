import { describe, expect, test } from "bun:test"
import {
  hasNonBlockingServiceIssue,
  hasServiceNeedingAttention,
  serverStatusDotClass,
  serviceStatusDotClass,
  summaryStatus,
} from "./indicator"

describe("serverStatusDotClass", () => {
  test("uses the success token while the server is healthy", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: true, connecting: false })).toBe("bg-icon-success-base")
  })

  test("uses the critical token when the server is down", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: false, connecting: false })).toBe("bg-icon-critical-base")
    expect(serverStatusDotClass({ ready: true, serverHealth: false, connecting: true })).toBe("bg-icon-critical-base")
  })

  test("pulses the neutral dot while reconnecting", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: true, connecting: true })).toBe(
      "bg-border-weak-base animate-pulse",
    )
  })

  test("stays neutral before status is ready", () => {
    expect(serverStatusDotClass({ ready: false, serverHealth: true, connecting: false })).toBe("bg-border-weak-base")
    expect(serverStatusDotClass({ ready: false, serverHealth: undefined, connecting: false })).toBe(
      "bg-border-weak-base",
    )
  })
})

describe("service status", () => {
  test("detects MCP failures and authentication needs", () => {
    expect(hasNonBlockingServiceIssue(["failed"])).toBe(true)
    expect(hasNonBlockingServiceIssue(["needs_auth"])).toBe(true)
    expect(hasNonBlockingServiceIssue(["connected", "pending", "disabled"])).toBe(false)
    expect(hasServiceNeedingAttention(["needs_auth"])).toBe(true)
    expect(hasServiceNeedingAttention(["failed", "connected", "pending", "disabled"])).toBe(false)
  })

  test("shows a dot only for noteworthy MCP states", () => {
    expect(serviceStatusDotClass(["needs_auth"])).toBe("bg-v2-background-bg-accent")
    expect(serviceStatusDotClass(["failed"])).toBe("bg-icon-warning-base")
    expect(serviceStatusDotClass(["connected", "pending", "disabled"])).toBeUndefined()
  })

  test("marks the summary trigger only for errors and attention", () => {
    expect(summaryStatus({ ready: true, serverHealth: true, mcp: ["connected"], connecting: false }).trigger).toBe(
      undefined,
    )
    expect(summaryStatus({ ready: true, serverHealth: true, mcp: ["needs_auth"], connecting: false })).toMatchObject({
      server: "bg-icon-success-base",
      mcp: "bg-v2-background-bg-accent",
      trigger: "bg-v2-background-bg-accent",
    })
    expect(summaryStatus({ ready: true, serverHealth: false, mcp: [], connecting: false })).toMatchObject({
      server: "bg-icon-critical-base",
      trigger: "bg-icon-critical-base",
    })
  })
})
