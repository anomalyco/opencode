import type { useLanguage } from "@/runtime/i18n/language"

export function elapsedTime(seconds: number, language: ReturnType<typeof useLanguage>) {
  if (seconds < 60) return language.plural("sidebar.inbox.elapsed.seconds", seconds)

  if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

  if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

  return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
}
