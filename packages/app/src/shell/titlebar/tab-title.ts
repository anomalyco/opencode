import { isFallbackTitle } from "@opencode/util/session-title-fallback"
import type { SessionInfo } from "@opencode/client/promise"
import type { useLanguage } from "@/runtime/i18n/language"

// Draft, preparing, and untitled session tabs share one localized label.
export function sessionTabTitle(title: string | undefined, fallback: string) {
  return !title || isFallbackTitle(title) ? fallback : title
}

export function sessionLastRunLabel(time: SessionInfo["time"] | undefined, language: ReturnType<typeof useLanguage>) {
  if (time?.idle === undefined) return
  return language.t("sidebar.session.lastRun", {
    time: new Intl.DateTimeFormat(language.intl(), { dateStyle: "medium", timeStyle: "medium" }).format(time.idle),
  })
}
