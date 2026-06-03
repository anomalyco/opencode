import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"
import { LiteLLMModels } from "./models"

const log = Log.create({ service: "plugin.litellm" })

export async function LiteLLMPlugin(input: PluginInput): Promise<Hooks> {
  return {
    provider: {
      id: "litellm",
      async models(provider, ctx) {
        const baseURL = (() => {
          if (provider.options?.baseURL) return provider.options.baseURL as string
          return undefined
        })()

        if (!baseURL) {
          log.warn("LiteLLM base URL not configured; set LITELLM_BASE_URL or provider.options.baseURL")
          return provider.models
        }

        const headers: Record<string, string> = {}
        if (ctx.auth?.type === "api" && ctx.auth.key) {
          headers["Authorization"] = `Bearer ${ctx.auth.key}`
        }

        return LiteLLMModels.get(baseURL, headers, provider.models).catch((error) => {
          log.error("failed to fetch litellm models", { error })
          return provider.models
        })
      },
    },
    auth: {
      provider: "litellm",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "api") return {}

        return {
          apiKey: auth.key,
        }
      },
      methods: [
        {
          label: "Enter LiteLLM API Key",
          type: "api",
          prompts: [
            {
              type: "text",
              key: "base_url",
              message: "LiteLLM proxy base URL (e.g. http://localhost:4000)",
              placeholder: "http://localhost:4000",
            },
          ],
        },
      ],
    },
  }
}
