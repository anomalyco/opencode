import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function CommandCodeAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "commandcode",
      methods: [
        {
          type: "api",
          label: "API key",
        },
      ],
    },
  }
}
