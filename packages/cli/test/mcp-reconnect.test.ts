import { describe, expect, test } from "bun:test"
import type { McpServer } from "@opencode/client"
import { reconnectTargets, stillDown } from "../src/commands/handlers/mcp/reconnect"

const server = (name: string, status: McpServer["status"] = { status: "pending" }): McpServer => ({ name, status })

describe("opencode mcp reconnect", () => {
  test("reconnects every failed server when no name is given", () => {
    expect(
      reconnectTargets([
        server("github", { status: "failed", error: "docker.sock: no such file" }),
        server("linear", { status: "connected" }),
        server("sentry", { status: "failed", error: "connect ECONNREFUSED" }),
        server("vault", { status: "disabled" }),
        server("docs", { status: "needs_auth", error: "expired" }),
      ]),
    ).toEqual(["github", "sentry"])
  })

  test("targets the named server even when it looks connected", () => {
    expect(reconnectTargets([server("github", { status: "connected" })], "github")).toEqual(["github"])
  })

  test("reports nothing to do when every server is healthy", () => {
    expect(reconnectTargets([server("github", { status: "connected" }), server("docs", { status: "disabled" })])).toEqual(
      [],
    )
  })

  test("reports targets that are still not connected", () => {
    expect(
      stillDown(
        [
          server("github", { status: "connected" }),
          server("sentry", { status: "failed", error: "still down" }),
          server("docs", { status: "needs_auth", error: "expired" }),
        ],
        ["github", "sentry", "docs"],
      ),
    ).toEqual(["sentry", "docs"])
  })

  test("reports nothing down when every target connected", () => {
    expect(stillDown([server("github", { status: "connected" })], ["github"])).toEqual([])
  })
})
