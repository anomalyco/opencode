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

/** Earliest run start first, so a session that starts working joins the end. Runs with no known start go last. */
export function compareWorking(a: { key: string; session: SessionTime }, b: { key: string; session: SessionTime }) {
  const start = (workingSince(a.session) ?? Infinity) - (workingSince(b.session) ?? Infinity)

  if (start) return start

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}
