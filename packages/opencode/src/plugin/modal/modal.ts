import type { Hooks } from "@opencode-ai/plugin"
import { ModalModels } from "./models"

export async function ModalPlugin(): Promise<Hooks> {
  return {
    provider: {
      id: "modal",
      async models(provider, ctx) {
        const apiKey = ctx.auth?.type === "api" ? ctx.auth.key : process.env.MODAL_PROXY_TOKEN
        const baseURL = Object.values(provider.models)[0]?.api.url
        if (!apiKey || !baseURL) return {}

        return ModalModels.get(baseURL, apiKey, provider.models).catch(() => ({}))
      },
    },
  }
}
