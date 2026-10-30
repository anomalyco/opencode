import type { AutomationCondition, AutomationInfo, AutomationWhen } from "@opencode/client/promise"

export type AutomationFilter = "all" | "active" | "paused" | "done"

export type AutomationKind = "until" | "if" | "schedule"

const STATUS_ORDER: Record<AutomationInfo["status"], number> = {
  active: 0,
  paused: 1,
  done: 2,
}

export function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

export function automationKind(item: Pick<AutomationInfo, "until" | "if">): AutomationKind {
  if (item.until !== undefined) return "until"

  if (item.if !== undefined) return "if"

  return "schedule"
}

export function automationTitle(item: Pick<AutomationInfo, "name" | "action">, maxLength = 56): string {
  const named = item.name?.trim()

  if (named) return named

  return truncateText(singleLine(item.action.prompt), maxLength)
}

export function formatAutomationWhen(when: AutomationWhen): string {
  switch (when.type) {
    case "in":
      return `in ${when.in}`
    case "at":
      return `at ${when.at}`
    case "every":
      return `every ${when.every}`
    case "cron":
      return `cron ${when.cron}`
  }
}

export function formatConditionGuard(condition: AutomationCondition): string | undefined {
  if (condition.type !== "shell") return undefined

  if (condition.changes === true) return "wakes when stdout changes"

  if (condition.is !== undefined) return `wakes when stdout == ${JSON.stringify(condition.is)}`

  if (condition.matches !== undefined) return `wakes when stdout matches /${condition.matches}/`

  return "wakes on exit 0"
}

export function formatConditionSummary(item: Pick<AutomationInfo, "until" | "if">): string | undefined {
  const mode = item.until !== undefined ? "until" : item.if !== undefined ? "if" : undefined
  const condition = item.until ?? item.if

  if (!mode || !condition) return undefined

  if (condition.type === "shell") {
    return `${mode} $ ${truncateText(singleLine(condition.run), 64)}`
  }

  return `${mode} code: ${truncateText(singleLine(condition.code), 64)}`
}

export function formatRelativeTime(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs
  const abs = Math.abs(diff)
  const seconds = Math.max(1, Math.round(abs / 1_000))

  const unit =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3_600
        ? `${Math.round(seconds / 60)}m`
        : seconds < 86_400
          ? `${Math.round(seconds / 3_600)}h`
          : `${Math.round(seconds / 86_400)}d`

  return diff >= 0 ? `in ${unit}` : `${unit} ago`
}

export function compareSchedules(a: AutomationInfo, b: AutomationInfo): number {
  const rank = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]

  if (rank !== 0) return rank

  if (a.status === "active" && b.status === "active") {
    const aDue = a.nextDueAt ?? Number.MAX_SAFE_INTEGER
    const bDue = b.nextDueAt ?? Number.MAX_SAFE_INTEGER

    if (aDue !== bDue) return aDue - bDue
  }

  return b.time.updated - a.time.updated
}

export function matchesAutomationQuery(
  item: AutomationInfo,
  query: string,
  extraSearchText?: string,
): boolean {
  const needle = query.trim().toLowerCase()

  if (!needle) return true
  const condition = item.until ?? item.if
  const conditionSource = condition ? (condition.type === "shell" ? condition.run : condition.code) : ""

  const haystack = [
    item.name ?? "",
    item.id,
    item.action.prompt,
    formatAutomationWhen(item.when),
    conditionSource,
    extraSearchText ?? "",
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(needle)
}
