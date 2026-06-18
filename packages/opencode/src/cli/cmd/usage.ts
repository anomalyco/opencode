import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { ProviderV2 } from "@opencode-ai/core/provider"

interface UsageWindow {
  name: string
  status: "ok" | "rate-limited"
  usagePercent: number
  resetInSec: number
  used: number
  limit: number
}

interface UsageResponse {
  plan: string
  windows: UsageWindow[]
  useBalance: boolean
  error?: string
}

const width = 58
const dim = (v: string) => UI.Style.TEXT_DIM + v + UI.Style.TEXT_NORMAL
const bold = (v: string) => UI.Style.TEXT_HIGHLIGHT_BOLD + v + UI.Style.TEXT_NORMAL
const warn = (v: string) => UI.Style.TEXT_WARNING + v + UI.Style.TEXT_NORMAL
const success = (v: string) => UI.Style.TEXT_SUCCESS + v + UI.Style.TEXT_NORMAL

function renderRow(label: string, value: string): string {
  const availableWidth = width - 1
  const paddingNeeded = availableWidth - stripAnsi(label).length - stripAnsi(value).length
  const padding = Math.max(0, paddingNeeded)
  return `│${label}${" ".repeat(padding)}${value} │`
}

function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ansi escape codes
  return str.replace(/\x1B\[[0-9;]*m/g, "")
}

function formatResetTime(seconds: number): string {
  if (seconds <= 0) return "now"
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.ceil((seconds % 3_600) / 60)
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"}`

  if (days > 0) return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day")
  if (hours > 0) return minutes > 0 ? `${unit(hours, "hour")} ${unit(minutes, "minute")}` : unit(hours, "hour")
  return minutes > 0 ? unit(minutes, "minute") : "less than a minute"
}

function progressBar(percent: number): string {
  const filled = Math.round((percent / 100) * 10)
  const color = percent >= 90 ? warn : percent >= 70 ? UI.Style.TEXT_WARNING : success
  return color("█".repeat(filled)) + dim("░".repeat(10 - filled))
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function displayUsage(usage: UsageResponse) {
  const planLabel = usage.plan === "lite" ? "Go (Lite)" : usage.plan === "black" ? "Black" : usage.plan
  const balanceLabel = usage.useBalance ? "On" : "Off"

  console.log("┌" + "─".repeat(width - 2) + "┐")
  console.log("│" + " ".repeat(Math.floor((width - 12) / 2)) + bold("GO USAGE") + " ".repeat(Math.ceil((width - 12) / 2)) + "│")
  console.log("├" + "─".repeat(width - 2) + "┤")
  console.log(renderRow("  Plan", bold(planLabel)))
  console.log(renderRow("  Use Balance", balanceLabel))

  if (usage.windows.length === 0) {
    console.log("├" + "─".repeat(width - 2) + "┤")
    if (usage.plan === "free") {
      console.log("│" + dim("  No usage limits. Subscribe to Go for usage tracking.") + " ".repeat(Math.max(0, width - 2 - 58)) + "│")
    } else {
      console.log("│" + dim("  No active usage windows found.") + " ".repeat(Math.max(0, width - 2 - 34)) + "│")
    }
    console.log("└" + "─".repeat(width - 2) + "┘")
    console.log()
    return
  }

  for (const w of usage.windows) {
    console.log("├" + "─".repeat(width - 2) + "┤")
    const statusIcon = w.status === "rate-limited" ? warn("●") : success("●")
    const usedStr = `${formatMoney(w.used)} / ${formatMoney(w.limit)}`
    const percentStr = `${w.usagePercent}%`
    const line = `  ${statusIcon} ${bold(w.name + " limit")}  ${usedStr}  ${percentStr}  ${progressBar(w.usagePercent)}`
    const lineLen = stripAnsi(line).length
    console.log(`│${line}${" ".repeat(Math.max(0, width - 2 - lineLen))}│`)

    const resetLabel = w.status === "rate-limited" ? warn(`  Resets in ${formatResetTime(w.resetInSec)}`) : dim(`  Resets in ${formatResetTime(w.resetInSec)}`)
    const resetLen = stripAnsi(resetLabel).length
    console.log(`│${resetLabel}${" ".repeat(Math.max(0, width - 2 - resetLen))}│`)
  }

  console.log("└" + "─".repeat(width - 2) + "┘")
  console.log()
  console.log(dim("  Manage your plan at https://opencode.ai/go"))
  console.log()
}

export const UsageCommand = effectCmd({
  command: "usage",
  describe: "show OpenCode Go usage and quota limits",
  instance: false,
  handler: Effect.fn("Cli.usage")(function* () {
    const { Provider } = yield* Effect.promise(() => import("@/provider/provider"))
    const provider = yield* Provider.Service
    const providers = yield* provider.list()

    // Find the opencode-go provider
    const opencodeProviderID = Object.keys(providers).find((id) => id.startsWith("opencode"))
    if (!opencodeProviderID) {
      return yield* fail("OpenCode provider not found. Run `opencode auth login` to set up.")
    }

    const p = providers[opencodeProviderID]
    const apiKey = p.key ?? p.options?.apiKey
    if (!apiKey || apiKey === "public") {
      return yield* fail("No API key configured for OpenCode provider. Run `opencode auth login` to set up.")
    }

    // Get the API URL from the first model
    const firstModel = Object.values(p.models)[0]
    if (!firstModel?.api?.url) {
      return yield* fail("Could not determine OpenCode API URL.")
    }

    // Derive the usage endpoint URL from the API URL
    // API URL is like https://opencode.ai/zen/go/v1, usage is at /zen/go/v1/usage
    const apiUrl = new URL(firstModel.api.url)
    const usageUrl = `${apiUrl.origin}${apiUrl.pathname.replace(/\/$/, "")}/usage`

    UI.empty()

    const response = yield* Effect.tryPromise({
      try: () => fetch(usageUrl, { headers: { Authorization: `Bearer ${apiKey}` } }),
      catch: (error) => new Error(`Failed to fetch usage: ${error instanceof Error ? error.message : String(error)}`),
    })

    if (!response.ok) {
      if (response.status === 401) {
        return yield* fail("Invalid API key. Run `opencode auth login` to re-authenticate.")
      }
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "Unknown error",
      })
      return yield* fail(`Failed to fetch usage (HTTP ${response.status}): ${body}`)
    }

    const usage = yield* Effect.tryPromise({
      try: () => response.json() as Promise<UsageResponse>,
      catch: () => new Error("Failed to parse usage response"),
    })

    if (usage.error) {
      return yield* fail(usage.error)
    }

    displayUsage(usage)
  }),
})
