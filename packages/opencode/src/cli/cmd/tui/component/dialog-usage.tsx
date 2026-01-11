import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { For, Show } from "solid-js"

type Theme = ReturnType<typeof useTheme>["theme"]

type UsageWindow = {
  usedPercent: number
  windowMinutes: number | null
  resetsAt: number | null
}

export type UsageEntry = {
  provider: string
  displayName: string
  snapshot: {
    primary: UsageWindow | null
    secondary: UsageWindow | null
    credits: {
      hasCredits: boolean
      unlimited: boolean
      balance: string | null
    } | null
    planType: string | null
    updatedAt: number
  }
}

export function DialogUsage(props: { entries: UsageEntry[] }) {
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <Show when={props.entries.length > 0} fallback={<text fg={theme.text}>No usage data available.</text>}>
        <For each={props.entries}>
          {(entry, index) => {
            const mergeReset = entry.provider === "copilot"
            const resetAt = entry.snapshot.primary?.resetsAt ?? entry.snapshot.secondary?.resetsAt ?? null
            return (
              <box flexDirection="column" marginTop={index() === 0 ? 0 : 1} gap={1}>
                <box flexDirection="column">
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {entry.displayName} Usage ({formatPlanType(entry.snapshot.planType)} Plan)
                  </text>
                  <text fg={theme.textMuted}>{"─".repeat(Math.max(24, entry.displayName.length + 20))}</text>
                </box>
                <Show when={entry.snapshot.primary}>
                  {(window) => (
                    <box flexDirection="column">
                      {renderWindow(getWindowLabel(entry.provider, "primary"), window(), theme, !mergeReset)}
                    </box>
                  )}
                </Show>
                <Show when={entry.snapshot.secondary}>
                  {(window) => (
                    <box flexDirection="column">
                      {renderWindow(getWindowLabel(entry.provider, "secondary"), window(), theme, !mergeReset)}
                    </box>
                  )}
                </Show>
                <Show when={mergeReset && resetAt !== null}>
                  <text fg={theme.textMuted}>Resets {formatResetTime(resetAt!)}</text>
                </Show>
                <Show when={entry.snapshot.credits}>
                  {(credits) => <text fg={theme.text}>{formatCreditsLabel(entry.provider, credits())}</text>}
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}

function getWindowLabel(provider: string, windowType: "primary" | "secondary"): string {
  if (provider === "copilot") {
    return windowType === "primary" ? "Usage" : "Completions"
  }
  return windowType === "primary" ? "Hourly" : "Weekly"
}

function renderWindow(label: string, window: UsageWindow, theme: Theme, showReset = true) {
  const usedPercent = clampPercent(window.usedPercent)
  const bar = renderProgressBar(usedPercent)
  const windowLabel = formatWindowLabel(label, window.windowMinutes)

  return (
    <box flexDirection="column">
      <text fg={theme.text}>
        {windowLabel} Limit: {bar} {usedPercent.toFixed(0)}% used
      </text>
      <Show when={showReset && window.resetsAt !== null}>
        <text fg={theme.textMuted}>Resets {formatResetTime(window.resetsAt!)}</text>
      </Show>
    </box>
  )
}

function formatWindowLabel(base: string, windowMinutes: number | null): string {
  if (!windowMinutes) return base
  const minutesPerHour = 60
  const minutesPerDay = 24 * minutesPerHour
  if (windowMinutes <= minutesPerDay) {
    const hours = Math.max(1, Math.round(windowMinutes / minutesPerHour))
    if (hours === 1) return "Hourly"
    return `${hours}h`
  }
  return base
}

function formatResetTime(resetAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = resetAt - now
  if (diff <= 0) return "now"
  if (diff < 60) return `in ${diff} seconds`
  if (diff < 3600) return `in ${Math.round(diff / 60)} minutes`
  if (diff < 86400) return `in ${Math.round(diff / 3600)} hours`
  return `in ${Math.round(diff / 86400)} days`
}

function renderProgressBar(usedPercent: number, width = 10): string {
  const filled = Math.round((usedPercent / 100) * width)
  const empty = width - filled
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`
}

function formatPlanType(planType: string | null): string {
  if (!planType) return "Unknown"
  const normalized = planType.replace(/_/g, " ")
  const parts: string[] = []
  for (const part of normalized.split(" ")) {
    if (!part) continue
    parts.push(part.slice(0, 1).toUpperCase() + part.slice(1))
  }
  return parts.join(" ")
}

function formatCreditsLabel(
  provider: string,
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null },
): string {
  if (provider === "copilot") {
    if (credits.unlimited) return "Quota: Unlimited"
    if (credits.balance) return `Quota: ${credits.balance}`
    if (!credits.hasCredits) return "Quota: Exhausted"
    return "Quota: Available"
  }
  return `Credits: ${formatCredits(credits)}`
}

function formatCredits(credits: { hasCredits: boolean; unlimited: boolean; balance: string | null }): string {
  if (!credits.hasCredits) return "None"
  if (credits.unlimited) return "Unlimited"
  if (credits.balance) return credits.balance
  return "Available"
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}
