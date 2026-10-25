const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

export type CatalogGateway = {
  kind: "catalog"
  id: string
  name: string
}

export type CustomGateway = {
  kind: "custom"
  id: string
  name: string
  baseURL: string
  models: Record<string, { name: string }>
}

export type Gateway = CatalogGateway | CustomGateway

// Curated AI gateways surfaced in the settings Gateways tab. Catalog entries
// connect through the regular provider flow; custom entries are preconfigured
// OpenAI-compatible providers where the user only supplies an API key.
export const gateways: Gateway[] = [
  {
    kind: "catalog",
    id: "bolt",
    name: "Bolt Zen",
  },
  {
    kind: "catalog",
    id: "openrouter",
    name: "OpenRouter",
  },
  {
    kind: "catalog",
    id: "vercel",
    name: "Vercel AI Gateway",
  },
  {
    kind: "custom",
    id: "kilo",
    name: "Kilo Gateway",
    baseURL: "https://api.kilo.ai/api/openrouter",
    models: {
      "kilo-auto/free": { name: "Kilo Auto (Free)" },
    },
  },
  {
    kind: "custom",
    id: "zoo",
    name: "Zoo Gateway",
    baseURL: "https://www.zoocode.dev/api/gateway/v1",
    models: {
      "anthropic/claude-sonnet-4": { name: "Claude Sonnet 4" },
    },
  },
]

// Provider config written to the server for custom gateways. Mirrors the
// shape produced by validateCustomProvider in dialog-custom-provider-form.ts.
export function gatewayProviderConfig(gateway: CustomGateway) {
  return {
    npm: OPENAI_COMPATIBLE,
    name: gateway.name,
    options: {
      baseURL: gateway.baseURL,
    },
    models: gateway.models,
  }
}
