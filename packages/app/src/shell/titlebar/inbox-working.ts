import type { useLanguage } from "@/runtime/i18n/language"

type SessionTime = { time: { busy?: number; idle?: number } }

/**
 * When the session's current run started. Undefined while the client still holds an earlier run's start (it ended at
 * `time.idle`, after `time.busy`) or the server does not record `time.busy`.
 */
export function workingSince(session: SessionTime) {
  const { busy, idle } = session.time

  if (busy === undefined || (idle !== undefined && idle > busy)) return undefined

  return busy
}

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

/** Earliest run start first, so a session that starts working joins the end. Runs with no known start go last. */
export function compareWorking(a: { key: string; session: SessionTime }, b: { key: string; session: SessionTime }) {
  const start = (workingSince(a.session) ?? Infinity) - (workingSince(b.session) ?? Infinity)

  if (start) return start

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}
