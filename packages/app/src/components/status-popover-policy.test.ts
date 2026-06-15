import { describe, expect, test } from "bun:test"
import type { McpStatus } from "@opencode-ai/sdk/v2/client"
import { mcpStatusDetail, mcpStatusIssue } from "./status-popover-policy"

describe("status popover MCP policy", () => {
  test("treats failed MCP status as critical degradation", () => {
    expect(
      mcpStatusIssue({
        context7: { status: "failed", error: "net::ERR_NETWORK_CHANGED" },
      }),
    ).toBe("critical")
    expect(
      mcpStatusIssue({
        context7: { status: "needs_client_registration", error: "client id required" },
        grep_app: { status: "needs_auth" },
      }),
    ).toBe("critical")
  })

  test("treats auth-only MCP status as warning", () => {
    expect(
      mcpStatusIssue({
        context7: { status: "connected" },
        grep_app: { status: "needs_auth" },
      }),
    ).toBe("warning")
  })

  test("leaves connected or disabled MCP status neutral", () => {
    expect(
      mcpStatusIssue({
        context7: { status: "connected" },
        grep_app: { status: "disabled" },
      }),
    ).toBeUndefined()
  })

  test("shows actionable detail for degraded MCP rows", () => {
    expect(mcpStatusDetail({ status: "needs_auth" }, "Authenticate")).toBe("Authenticate")
    expect(mcpStatusDetail({ status: "failed", error: "tools/list failed" }, "Authenticate")).toBe(
      "tools/list failed",
    )
    expect(
      mcpStatusDetail({ status: "needs_client_registration", error: "client id required" }, "Authenticate"),
    ).toBe("client id required")
    expect(mcpStatusDetail({ status: "connected" } as McpStatus, "Authenticate")).toBeUndefined()
  })
})
