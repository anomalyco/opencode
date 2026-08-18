import { describe, expect, test } from "bun:test"
import { FigmaPlugin } from "@/plugin/figma"

describe("plugin.figma", () => {
  test("adds the OpenCode client ID to configured Figma servers", async () => {
    const config = {
      mcp: {
        figma: {
          type: "remote" as const,
          url: "https://mcp.figma.com/mcp",
          oauth: { scope: "mcp:connect" } as { scope: string; clientId?: string },
        },
      },
    }
    const hooks = await FigmaPlugin({} as never)

    await hooks.config!(config as never)

    expect(config.mcp.figma.oauth).toEqual({ clientId: "3zVHNs9kINDDrk8loekLZV", scope: "mcp:connect" })
  })

  test("preserves an existing client ID", async () => {
    const config = {
      mcp: {
        figma: {
          type: "remote" as const,
          url: "https://mcp.figma.com/mcp",
          oauth: { clientId: "configured-client-id" },
        },
      },
    }
    const hooks = await FigmaPlugin({} as never)

    await hooks.config!(config as never)

    expect(config.mcp.figma.oauth.clientId).toBe("configured-client-id")
  })

  test("does not create or enable Figma servers", async () => {
    const config = {
      mcp: {
        disabled: {
          type: "remote" as const,
          url: "https://mcp.figma.com/mcp",
          oauth: false as const,
        },
        other: {
          type: "remote" as const,
          url: "https://mcp.example.com/mcp",
        },
      },
    }
    const hooks = await FigmaPlugin({} as never)

    await hooks.config!(config as never)

    expect(config.mcp).toEqual({
      disabled: {
        type: "remote",
        url: "https://mcp.figma.com/mcp",
        oauth: false,
      },
      other: {
        type: "remote",
        url: "https://mcp.example.com/mcp",
      },
    })
  })
})
