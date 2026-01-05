import { Auth } from "@/auth"
import z from "zod"

export namespace AnthropicUsage {
  const UsageWindow = z.object({
    utilization: z.number(),
    resets_at: z.string().nullable(),
  })

  export const UsageData = z.object({
    five_hour: UsageWindow.nullish(),
    seven_day: UsageWindow.nullish(),
    seven_day_opus: UsageWindow.nullish(),
  })
  export type UsageData = z.infer<typeof UsageData>

  export async function fetch(): Promise<UsageData | null> {
    const auth = await Auth.get("anthropic")
    if (!auth || auth.type !== "oauth") {
      return null
    }

    try {
      const response = await globalThis.fetch("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.access}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        console.error(`Anthropic usage API error: ${response.status}`)
        return null
      }

      const data = await response.json()
      const parsed = UsageData.safeParse(data)
      if (!parsed.success) {
        console.error("Failed to parse Anthropic usage data:", parsed.error)
        return null
      }

      return parsed.data
    } catch (error) {
      console.error("Failed to fetch Anthropic usage:", error)
      return null
    }
  }

  export function formatResetTime(isoString: string | null): string {
    if (!isoString) return "N/A"
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()

    if (diffMs <= 0) return "refreshing"

    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)

    if (diffHours >= 24) {
      const days = Math.floor(diffHours / 24)
      return `${days}d ${diffHours % 24}h`
    }
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`
    }
    if (diffMins > 0) {
      return `${diffMins}m`
    }
    return "soon"
  }
}
