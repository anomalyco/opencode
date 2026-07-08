import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function HuaweiAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "huawei",
      methods: [
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
