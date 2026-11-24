import type { SessionRef } from "@opencode/plugin/gui"

/**
 * Whether a prompt to the session could gain anything by waiting for this desktop to attach to it. It could not when
 * the session's server is not connected or is one this app cannot talk to, when the session has no location yet, or
 * when the window is offline and the server is not on this computer: an attachment started then answers nothing in
 * time, so the prompt goes at once.
 */
export function attachable(session: SessionRef, online: boolean) {
  return session.server.connected && session.server.compatible && session.location !== undefined && (online || session.server.local)
}

/**
 * Whether a session that runs in one of this window's tabs attaches although nobody has opened it there. An agent
 * lists the browser tools only once a desktop attached to its session, and after the app starts only the session on
 * screen attaches: one the server resumed, or that an automation, a finished job or a subagent woke, would run every
 * step without them until someone opened its tab. A session that holds the browser grant has a pane already, this
 * window's or another's, and keeps it: a window that only lists a tab must not take the pane from the one that shows
 * it. Details this window has not loaded say nothing about a grant, so the session waits for them.
 */
export function attachesUnopened(session: SessionRef, online: boolean) {
  if (!attachable(session, online)) return false
  const data = session.server.data.session
  const info = data.get(session.id)

  return (
    info !== undefined &&
    data.status(session.id) === "running" &&
    !info.permissions?.some((rule) => rule.action === "browser" && rule.resource === "*" && rule.effect === "allow")
  )
}
