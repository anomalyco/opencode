#!/usr/bin/env bun

import { Auth } from "../src/auth"

const endpoint = "https://chatgpt.com/backend-api/wham/usage"

interface UsageWindow {
  used_percent: number
  limit_window_seconds: number
  reset_after_seconds: number
  reset_at: number
}

interface RateLimit {
  allowed: boolean
  limit_reached: boolean
  primary_window: UsageWindow
  secondary_window: UsageWindow | null
}

interface UsageResponse {
  plan_type: string
  rate_limit: RateLimit
}

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (!h) return `${m}m`
  if (!m) return `${h}h`
  return `${h}h ${m}m`
}

function formatWindow(label: string, window: UsageWindow | null) {
  if (!window) return `${label}: n/a`
  return `${label}: ${window.used_percent}% used, resets in ${duration(window.reset_after_seconds)}`
}

async function fetchUsage(id: string, auth: Auth.Info & { type: "oauth" }) {
  const response = await fetch(endpoint, {
    headers: {
      accept: "*/*",
      authorization: `Bearer ${auth.access}`,
      "chatgpt-account-id": auth.accountId ?? "",
      "oai-language": "en-US",
      referer: "https://chatgpt.com/codex/settings/usage",
      "user-agent": "opencode-codex-usage-poc/1.0",
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 120)}` : ""}`)
  }

  const data = (await response.json()) as UsageResponse
  console.log(`\n${id}`)
  console.log(`plan: ${data.plan_type}`)
  console.log(`allowed: ${data.rate_limit.allowed}`)
  console.log(`limit reached: ${data.rate_limit.limit_reached}`)
  console.log(formatWindow("5h", data.rate_limit.primary_window))
  console.log(formatWindow("weekly", data.rate_limit.secondary_window))
}

const auth = await Auth.all()
const entries = Object.entries(auth).flatMap(([id, value]) => {
  if (!id.startsWith("openai-profile-")) return []
  if (value.type !== "oauth") return []
  if (!value.access) return []
  if (!value.accountId) return []
  return [[id, value] as const]
})

if (!entries.length) {
  console.log("No ChatGPT OAuth profiles with accountId were found.")
  process.exit(0)
}

for (const [id, value] of entries) {
  await fetchUsage(id, value).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`\n${id}`)
    console.log(`error: ${message}`)
  })
}
