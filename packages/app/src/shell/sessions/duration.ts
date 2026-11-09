import type { useLanguage } from "@/runtime/i18n/language"
import { workingSince } from "@/shell/titlebar/inbox-working"

type SessionTime = { time: { busy?: number; idle?: number } }

/** Elapsed time belongs to the current run, never the session's creation or last message. */
export function workingDuration(session: SessionTime, now: number, language: ReturnType<typeof useLanguage>) {
  const since = workingSince(session)
  if (since === undefined) return
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return language.plural("sidebar.inbox.elapsed.seconds", seconds)
  if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))
  if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))
  return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
}
