import type { UiI18n } from "../context/i18n"

export type Runtime = {
  start: number
  end?: number
}

export function formatDuration(i18n: Pick<UiI18n, "locale" | "t">, ms: number) {
  if (!(ms >= 0)) return ""
  const num = new Intl.NumberFormat(i18n.locale())
  const total = Math.round(ms / 1000)
  if (total < 60) return i18n.t("ui.message.duration.seconds", { count: num.format(total) })
  return i18n.t("ui.message.duration.minutesSeconds", {
    minutes: num.format(Math.floor(total / 60)),
    seconds: num.format(total % 60),
  })
}

export function elapsed(time?: Runtime, now = Date.now()) {
  if (!time) return
  const end = typeof time.end === "number" ? time.end : now
  const ms = end - time.start
  if (!(ms >= 0)) return
  return ms
}

export function taskState(i18n: Pick<UiI18n, "t">, status?: string) {
  if (status === "pending") return i18n.t("ui.message.queued")
  if (status === "running") return i18n.t("ui.tool.task.running")
  if (status === "completed") return i18n.t("ui.tool.task.completed")
  if (status === "error") return i18n.t("ui.toolErrorCard.failed")
}
