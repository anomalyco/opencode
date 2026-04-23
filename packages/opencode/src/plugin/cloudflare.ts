import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function CloudflareWorkersAuthPlugin(_input: PluginInput): Promise<Hooks> {
  const prompts = [
    ...(!process.env.CLOUDFLARE_ACCOUNT_ID
      ? [
          {
            type: "text" as const,
            key: "accountId",
            message: "Enter your Cloudflare Account ID",
            placeholder: "e.g. 1234567890abcdef1234567890abcdef",
          },
        ]
      : []),
  ]

  return {
    auth: {
      provider: "cloudflare-workers-ai",
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

export async function CloudflareAIGatewayAuthPlugin(_input: PluginInput): Promise<Hooks> {
  const prompts = [
    ...(!process.env.CLOUDFLARE_ACCOUNT_ID
      ? [
          {
            type: "text" as const,
            key: "accountId",
            message: "Enter your Cloudflare Account ID",
            placeholder: "e.g. 1234567890abcdef1234567890abcdef",
          },
        ]
      : []),
    ...(!process.env.CLOUDFLARE_GATEWAY_ID
      ? [
          {
            type: "text" as const,
            key: "gatewayId",
            message: "Enter your Cloudflare AI Gateway ID",
            placeholder: "e.g. my-gateway",
          },
        ]
      : []),
  ]

  return {
    auth: {
      provider: "cloudflare-ai-gateway",
      methods: [
        {
          type: "api",
          label: "Gateway API token",
          prompts,
        },
      ],
    },
  }
}
