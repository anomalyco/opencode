export type TerminalTitleStatus = "attention" | "busy" | "idle"

const TITLE_MAX = 40

export function resolveTerminalTitleStatus(input: {
  sessionStatus?: { type: string } | undefined
  questions?: readonly unknown[] | undefined
  permissions?: readonly unknown[] | undefined
}): TerminalTitleStatus {
  if ((input.questions?.length ?? 0) > 0 || (input.permissions?.length ?? 0) > 0) return "attention"
  if (input.sessionStatus?.type === "busy" || input.sessionStatus?.type === "retry") return "busy"
  return "idle"
}

export function truncateTerminalTitleName(name: string) {
  if (name.length <= TITLE_MAX) return name
  return name.slice(0, TITLE_MAX - 3) + "..."
}

/** Status prefix: attention `? `, busy/retry `* `, idle none. Branding: `KC | ` for named sessions/plugins. */
export function formatTerminalTitle(input: {
  status: TerminalTitleStatus
  name: string
  branded?: boolean
}) {
  const statusPrefix = input.status === "attention" ? "? " : input.status === "busy" ? "* " : ""
  if (!input.branded) return `${statusPrefix}${input.name}`
  return `${statusPrefix}KC | ${input.name}`
}
