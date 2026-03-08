import { Auth } from "@/auth"
import { createResource, onCleanup } from "solid-js"

const endpoint = "https://chatgpt.com/backend-api/wham/usage"

interface UsageWindow {
  used_percent: number
}

interface RateLimit {
  primary_window: UsageWindow
  secondary_window: UsageWindow | null
}

interface UsagePayload {
  rate_limit: RateLimit
}

export interface CodexUsage {
  id: string
  primary: number
  secondary: number | null
  error?: string
}

export async function loadCodexUsage() {
  const auth = await Auth.all()
  const profiles = Object.entries(auth).flatMap(([id, value]) => {
    if (value.type !== "oauth") return []
    if (!id.startsWith("openai-profile-") && id !== "openai") return []
    if (!value.access || !value.accountId) return []
    return [[id, value] as const]
  })

  const usage = await Promise.all(
    profiles.map(async ([id, value]) => {
      const response = await fetch(endpoint, {
        headers: {
          accept: "*/*",
          authorization: `Bearer ${value.access}`,
          "chatgpt-account-id": value.accountId ?? "",
          "oai-language": "en-US",
          referer: "https://chatgpt.com/codex/settings/usage",
          "user-agent": "opencode-codex-usage/1.0",
        },
      }).catch(() => undefined)

      if (!response || !response.ok) {
        return {
          id,
          primary: 0,
          secondary: null,
          error: "unavailable",
        } satisfies CodexUsage
      }

      const payload = (await response.json()) as UsagePayload
      return {
        id,
        primary: payload.rate_limit.primary_window.used_percent,
        secondary: payload.rate_limit.secondary_window?.used_percent ?? null,
      } satisfies CodexUsage
    }),
  )

  return usage.toSorted((a, b) => a.id.localeCompare(b.id))
}

const interval = 30_000

export function useCodexUsage() {
  const [usage, controls] = createResource(loadCodexUsage)
  const timer = setInterval(() => void controls.refetch(), interval)
  timer.unref?.()
  onCleanup(() => clearInterval(timer))
  return [usage, controls] as const
}
