import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function EdenAIAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "edenai",
      methods: [
        {
          type: "api",
          label: "Eden AI API Key",
        },
      ],
    },
  }
}
