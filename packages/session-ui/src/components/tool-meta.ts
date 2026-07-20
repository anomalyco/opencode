import type { UiI18n } from "@opencode-ai/ui/context/i18n"
import type { MessageMetadataDisplayOptions } from "./message-options"

export type ToolMetaInput = {
  status: "pending" | "running" | "completed" | "error" | "interrupted"
  start?: number
  end?: number
  now?: number
}

export function toolMeta(i18n: UiI18n, input: ToolMetaInput, options?: MessageMetadataDisplayOptions) {
  const stamp = options?.toolTimestamp && typeof input.start === "number" ? formatTime(i18n.locale(), input.start) : ""
  if (input.status === "interrupted") {
    return [stamp, options?.toolStatus ? i18n.t("ui.message.interrupted") : ""].filter(Boolean).join(" · ")
  }
  if (input.status === "error") {
    return [stamp, options?.toolStatus ? i18n.t("ui.toolErrorCard.failed") : ""].filter(Boolean).join(" · ")
  }

  const end = input.status === "completed" ? input.end : input.now
  const duration =
    options?.toolDuration && typeof input.start === "number" && typeof end === "number"
      ? formatDuration(i18n, end - input.start)
      : ""
  return [stamp, duration].filter(Boolean).join(" · ")
}

function formatTime(locale: string, value: number) {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(value)
}

function formatDuration(i18n: UiI18n, value: number) {
  if (value < 0) return ""
  const total = Math.round(value / 1000)
  if (total < 60) return i18n.t("ui.message.duration.seconds", { count: String(total) })

  return i18n.t("ui.message.duration.minutesSeconds", {
    minutes: String(Math.floor(total / 60)),
    seconds: String(total % 60),
  })
}
