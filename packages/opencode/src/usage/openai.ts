import { Auth } from "@/auth"
import z from "zod"

export namespace OpenAIUsage {
  export const PlanType = z.enum([
    "free",
    "plus",
    "pro",
    "team",
    "business",
    "enterprise",
    "edu",
    "education",
    "guest",
    "go",
    "free_workspace",
    "quorum",
    "k12",
  ])
  export type PlanType = z.infer<typeof PlanType>

  export const RateLimitWindow = z.object({
    used_percent: z.number(),
    limit_window_seconds: z.number(),
    reset_at: z.number(),
  })

  export const RateLimitDetails = z.object({
    allowed: z.boolean().optional(),
    limit_reached: z.boolean().optional(),
    primary_window: RateLimitWindow.optional().nullable(),
    secondary_window: RateLimitWindow.optional().nullable(),
  })

  export const CreditStatus = z.object({
    has_credits: z.boolean().optional(),
    unlimited: z.boolean().optional(),
    balance: z.union([z.string(), z.number()]).optional().nullable(),
  })

  export const UsageData = z.object({
    plan_type: PlanType,
    rate_limit: RateLimitDetails.optional().nullable(),
    credits: CreditStatus.optional().nullable(),
  })
  export type UsageData = z.infer<typeof UsageData>

  export function getPlanDisplayName(planType: PlanType): string {
    const names: Record<PlanType, string> = {
      free: "Free",
      plus: "Plus",
      pro: "Pro",
      team: "Team",
      business: "Business",
      enterprise: "Enterprise",
      edu: "Education",
      education: "Education",
      guest: "Guest",
      go: "Go",
      free_workspace: "Free Workspace",
      quorum: "Quorum",
      k12: "K-12",
    }
    return names[planType] || planType
  }

  export async function fetch(): Promise<UsageData | null> {
    const auth = await Auth.get("openai")
    if (!auth || auth.type !== "oauth") {
      return null
    }

    try {
      const response = await globalThis.fetch("https://chatgpt.com/backend-api/wham/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.access}`,
          Accept: "application/json",
          "User-Agent": "opencode-cli",
        },
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        console.error(`OpenAI usage API error: ${response.status}`)
        return null
      }

      const data = await response.json()
      const parsed = UsageData.safeParse(data)
      if (!parsed.success) {
        console.error("Failed to parse OpenAI usage data:", parsed.error)
        return null
      }

      return parsed.data
    } catch (error) {
      console.error("Failed to fetch OpenAI usage:", error)
      return null
    }
  }

  export function formatWindowDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days >= 1) {
      return `${days}d`
    }
    if (hours >= 1) {
      return `${hours}h`
    }
    return `${minutes}m`
  }

  export function formatResetTime(unixTimestamp: number): string {
    const date = new Date(unixTimestamp * 1000)
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

  export function formatCredits(balance: string | number | null | undefined): string {
    if (balance === null || balance === undefined) {
      return "N/A"
    }
    const num = typeof balance === "string" ? Number(balance) : balance
    if (typeof num !== "number" || !Number.isFinite(num)) {
      return "N/A"
    }
    return `$${num.toFixed(2)}`
  }
}
