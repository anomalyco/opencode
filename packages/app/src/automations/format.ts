import type { AutomationInfo } from "@opencode/client/promise"
import type { useLanguage } from "@/runtime/i18n/language"

export type AutomationFilter = "all" | AutomationInfo["status"]

type Translate = ReturnType<typeof useLanguage>["t"]

export function triggerLabel(trigger: AutomationInfo["trigger"], t: Translate) {
  switch (trigger.type) {
    case "at":
      return trigger.at
    case "every":
      return t("automations.every", { interval: trigger.every })
    case "cron":
      return trigger.cron
    case "event":
      return trigger.event
  }
}

export function statusLabel(row: AutomationInfo, t: Translate) {
  if (row.status === "paused" && row.lastOutcome === "failed") return t("automations.status.failed")

  if (row.status === "done" && row.lastOutcome === "expired") return t("automations.status.expired")

  return t(`automations.status.${row.status}`)
}

const rank = { active: 0, paused: 1, done: 2 }

export function compareAutomations(a: AutomationInfo, b: AutomationInfo) {
  return (
    rank[a.status] - rank[b.status] ||
    (a.status === "active" ? (a.nextDueAt ?? Infinity) - (b.nextDueAt ?? Infinity) : 0) ||
    b.time.updated - a.time.updated
  )
}
