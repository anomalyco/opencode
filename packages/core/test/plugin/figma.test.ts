import { describe, expect, test } from "bun:test"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { FigmaPlugin } from "@opencode-ai/core/plugin/figma"

describe("plugin.figma", () => {
  test("adds the OpenCode client ID to configured Figma servers", () => {
    const server = new ConfigMCP.Remote({
      type: "remote",
      url: "https://mcp.figma.com/mcp",
      oauth: new ConfigMCP.OAuth({ scope: "mcp:connect" }),
    })

    FigmaPlugin.apply(server)

    expect(server.oauth).toEqual({
      client_id: "3zVHNs9kINDDrk8loekLZV",
      callback_port: 19876,
      scope: "mcp:connect",
    })
  })

  test("preserves an existing client ID", () => {
    const server = new ConfigMCP.Remote({
      type: "remote",
      url: "https://mcp.figma.com/mcp",
      oauth: new ConfigMCP.OAuth({ client_id: "configured-client-id", callback_port: 4321 }),
    })

    FigmaPlugin.apply(server)

    expect(server.oauth).toEqual({ client_id: "configured-client-id", callback_port: 19876 })
  })

  test("does not enable OAuth or modify non-Figma servers", () => {
    const disabled = new ConfigMCP.Remote({
      type: "remote",
      url: "https://mcp.figma.com/mcp",
      oauth: false,
    })
    const other = new ConfigMCP.Remote({
      type: "remote",
      url: "https://mcp.example.com/mcp",
    })

    FigmaPlugin.apply(disabled)
    FigmaPlugin.apply(other)

    expect(disabled.oauth).toBe(false)
    expect(other.oauth).toBeUndefined()
  })
})
