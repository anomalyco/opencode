import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const CLIENT_ID = "3zVHNs9kINDDrk8loekLZV"

export async function FigmaPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    config: async (config) => {
      Object.values(config.mcp ?? {}).forEach((server) => {
        if (server.type !== "remote" || server.oauth === false) return
        if (!URL.canParse(server.url) || new URL(server.url).hostname !== "mcp.figma.com") return
        if (server.oauth?.clientId) return
        server.oauth = { ...server.oauth, clientId: CLIENT_ID }
      })
    },
  }
}
