import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function CommandcodeGoplanAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "commandcode-goplan",
      methods: [
        {
          label: "API Key",
          type: "api",
        },
      ],
    },
  }
}
