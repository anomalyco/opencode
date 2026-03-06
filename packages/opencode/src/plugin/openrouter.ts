import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Auth } from "@/auth"

const CREDITS_ENDPOINT = "https://openrouter.ai/api/v1/credits"

type Credits = {
  data?: {
    total_credits?: number
    total_usage?: number
    remaining_credits?: number
    limit_remaining?: number
  }
}

function remaining(data: Credits["data"]) {
  if (!data) return
  if (typeof data.remaining_credits === "number") return data.remaining_credits
  if (typeof data.limit_remaining === "number") return data.limit_remaining
  if (typeof data.total_credits === "number" && typeof data.total_usage === "number") {
    return data.total_credits - data.total_usage
  }
}

export async function OpenRouterPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "tui.footer.model": async (input, output) => {
      if (input.mode !== "normal") return
      if (!input.model) return
      if (input.model.providerID !== "openrouter") return

      const auth = await Auth.get("openrouter")
      if (auth?.type !== "api") return

      const response = await fetch(CREDITS_ENDPOINT, {
        method: "GET",
        headers: {
          authorization: `Bearer ${auth.key}`,
        },
      }).catch(() => undefined)
      if (!response?.ok) return

      const json = (await response.json().catch(() => undefined)) as Credits | undefined
      const credit = remaining(json?.data)
      if (typeof credit !== "number") return

      output.info.push(
        `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Math.max(0, credit))} left`,
      )
      output.refresh_ms = 60_000
    },
  }
}
