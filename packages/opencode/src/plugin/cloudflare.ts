import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function CloudflareWorkersAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "cloudflare-workers-ai",
      methods: [
        {
          type: "api",
          label: "API key",
          prompts: [
            {
              type: "text",
              key: "accountId",
              message: "Enter your Cloudflare Account ID",
              placeholder: "e.g. 1234567890abcdef1234567890abcdef",
            },
          ],
        },
      ],
    },
  }
}

export async function CloudflareAIGatewayAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "cloudflare-ai-gateway",
      methods: [
        {
          type: "api",
          label: "Gateway API token",
          prompts: [
            {
              type: "text",
              key: "accountId",
              message: "Enter your Cloudflare Account ID",
              placeholder: "e.g. 1234567890abcdef1234567890abcdef",
            },
            {
              type: "text",
              key: "gatewayId",
              message: "Enter your Cloudflare AI Gateway ID",
              placeholder: "e.g. my-gateway",
            },

          ],
        },
      ],
    },
  }
}
