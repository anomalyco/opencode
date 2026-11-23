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
