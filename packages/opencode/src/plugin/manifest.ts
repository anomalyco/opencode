import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function ManifestAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "manifest",
      methods: [
        {
          type: "api",
          label: "Manifest API Key",
        },
      ],
    },
  }
}
