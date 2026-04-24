import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function AnthropicAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      methods: [
        {
          label: "API key",
          type: "api",
        },
      ],
    },
  }
}
