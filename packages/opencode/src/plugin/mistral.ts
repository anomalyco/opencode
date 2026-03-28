import type { Hooks, PluginInput } from "@opencode-ai/plugin"

function normalizeUrl(url: string) {
  return url.replace(/\/$/, "")
}

export async function MistralAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "mistral",
      async loader(getAuth) {
        const info = await getAuth()
        if (!info || info.type !== "api") return {}

        const endpoint = info.endpoint
        const baseURL = endpoint ? normalizeUrl(endpoint) : undefined

        return {
          baseURL,
          apiKey: info.key ?? "",
        }
      },
      methods: [
        {
          type: "api",
          label: "Mistral API Key (api.mistral.ai)",
          prompts: [
            {
              type: "secret",
              key: "key",
              message: "Enter your Mistral API key",
              validate: (value) => {
                if (!value) return "API key is required"
                return undefined
              },
            },
          ],
          authorize(inputs) {
            return {
              type: "success",
              key: inputs.key,
            }
          },
        },
        {
          type: "api",
          label: "Mistral Enterprise (custom endpoint)",
          prompts: [
            {
              type: "text",
              key: "endpoint",
              message: "Enter your Mistral Enterprise endpoint URL",
              placeholder: "https://mistral.enterprise.com",
              validate: (value) => {
                if (!value) return "Endpoint URL is required"
                try {
                  const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`)
                  if (!url.hostname) return "Please enter a valid URL"
                  return undefined
                } catch {
                  return "Please enter a valid URL (e.g., https://mistral.enterprise.com)"
                }
              },
            },
            {
              type: "secret",
              key: "key",
              message: "Enter your Mistral API key",
              validate: (value) => {
                if (!value) return "API key is required"
                return undefined
              },
            },
          ],
          authorize(inputs) {
            return {
              type: "success",
              key: inputs.key,
              endpoint: normalizeUrl(inputs.endpoint),
            }
          },
        },
      ],
    },
  }
}
