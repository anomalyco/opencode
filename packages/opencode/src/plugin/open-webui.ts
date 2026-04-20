import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as ProviderTransform from "../provider/transform"
import { discoverOpenWebUIModels } from "../provider/open-webui-discovery"

export async function OpenWebUIAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "openwebui",
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "api") return {}
        const raw = (auth as { type: "api"; metadata?: Record<string, string> }).metadata?.baseURL
        if (!raw) return {}
        return {
          baseURL: ProviderTransform.openwebuiOpenAICompatibleBase(raw.replace(/\/+$/, "")),
        }
      },
      methods: [
        {
          type: "api",
          label: "API key + instance URL",
          prompts: [
            {
              type: "text",
              key: "baseURL",
              message: "Enter your Open WebUI instance URL",
              placeholder: "https://your-instance.com",
              validate: (v) => (!v?.trim() ? "Required" : undefined),
            },
          ],
          async authorize(inputs) {
            const baseURL = inputs?.baseURL?.trim() ?? ""
            const apiKey = inputs?.apiKey?.trim() ?? ""
            if (!baseURL || !apiKey) return { type: "failed" }

            const result = await discoverOpenWebUIModels({
              rawBaseURL: baseURL,
              apiKey,
              timeoutMs: 10_000,
            })
            if (!result.ok) return { type: "failed" }

            return {
              type: "success",
              key: apiKey,
              metadata: {
                baseURL: baseURL.replace(/\/+$/, ""),
              },
            }
          },
        },
      ],
    },
  }
}
