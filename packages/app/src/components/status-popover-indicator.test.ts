import { describe, expect, test } from "bun:test"
import {
  hasNonBlockingServiceIssue,
  hasServiceNeedingAttention,
  serverStatusDotClass,
} from "./status-popover-indicator"

describe("serverStatusDotClass", () => {
  test("uses the success token while the server and services are healthy", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: true, attention: false, issue: false })).toBe(
      "bg-icon-success-base",
    )
  })

  test("uses the session attention token when a service needs attention", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: true, attention: true, issue: true })).toBe(
      "bg-v2-background-bg-accent",
    )
  })

  test("uses the warning token for non-blocking errors", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: true, attention: false, issue: true })).toBe(
      "bg-icon-warning-base",
    )
  })

  test("uses the critical token only after the server connection drops", () => {
    expect(serverStatusDotClass({ ready: true, serverHealth: false, attention: false, issue: false })).toBe(
      "bg-icon-critical-base",
    )
    expect(serverStatusDotClass({ ready: true, serverHealth: false, attention: true, issue: true })).toBe(
      "bg-icon-critical-base",
    )
  })

  test("stays neutral before status is ready", () => {
    expect(serverStatusDotClass({ ready: false, serverHealth: true, attention: false, issue: false })).toBe(
      "bg-border-weak-base",
    )
    expect(serverStatusDotClass({ ready: false, serverHealth: undefined, attention: false, issue: false })).toBe(
      "bg-border-weak-base",
    )
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

describe("hasNonBlockingServiceIssue", () => {
  test("detects MCP and LSP failures", () => {
    expect(hasNonBlockingServiceIssue({ mcp: ["failed"], lsp: [] })).toBe(true)
    expect(hasNonBlockingServiceIssue({ mcp: [], lsp: ["error"] })).toBe(true)
  })

  test("includes attention states in the issue set", () => {
    expect(hasNonBlockingServiceIssue({ mcp: ["needs_auth"], lsp: [] })).toBe(true)
    expect(hasNonBlockingServiceIssue({ mcp: ["needs_client_registration"], lsp: [] })).toBe(true)
  })

  test("ignores healthy and inactive states", () => {
    expect(hasNonBlockingServiceIssue({ mcp: ["connected", "pending", "disabled"], lsp: ["connected"] })).toBe(false)
  })
})
