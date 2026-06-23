import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function OmniRouteAuthPlugin(_input: PluginInput): Promise<Hooks> {
  const prompts = []
  if (!process.env.OMNIROUTE_BASE_URL) {
    prompts.push({
      type: "text" as const,
      key: "baseURL",
      message: "Enter the OmniRoute endpoint URL",
      placeholder: "e.g. http://localhost:8080",
      validate: (value: string) => {
        try {
          new URL(value)
          return undefined
        } catch {
          return "Please enter a valid URL"
        }
      },
    })
  }

  return {
    auth: {
      provider: "omniroute",
      methods: [
        {
          type: "api",
          label: "API key",
          prompts,
        },
      ],
    },
  }
}
