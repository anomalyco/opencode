import type { SessionInfo } from "@opencode/client/promise"
import type { useLanguage } from "@/runtime/i18n/language"

export function sessionLastRunLabel(time: SessionInfo["time"] | undefined, language: ReturnType<typeof useLanguage>) {
  if (time?.idle === undefined) return
  return language.t("sidebar.session.lastRun", {
    time: new Intl.DateTimeFormat(language.intl(), { dateStyle: "medium", timeStyle: "medium" }).format(time.idle),
  })
}
