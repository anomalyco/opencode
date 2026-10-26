export type SessionLink = { sessionID: string; server?: string }

const MAX_LINK_LENGTH = 2048

const SESSION_ID = /^ses_[0-9A-Za-z]{8,64}$/

// A client-local server key: "sidecar" or an extension's `${extension}:${id}`.
const SERVER_KEY = /^[\w.@:-]{1,256}$/

/**
 * Reads `opencode://session/<id>[?server=<origin-or-key>]`. Desktop main validates links before they reach the app;
 * this checks again because the app is the side that acts on them.
 */
export function parseSessionLink(value: string): SessionLink | undefined {
  if (value.length > MAX_LINK_LENGTH || /[\s\u0000-\u001f\u007f]/.test(value)) return
  const url = URL.parse(value)

  if (!url || url.protocol !== "opencode:" || url.hostname !== "session") return

  if (url.username || url.password || url.port || url.hash) return
  const sessionID = url.pathname.slice(1)

  if (!SESSION_ID.test(sessionID)) return
  const keys = [...url.searchParams.keys()]

  if (keys.length > 1 || keys.some((key) => key !== "server")) return
  const hint = url.searchParams.get("server")

  if (hint === null) return { sessionID }
  const server = serverHint(hint)

  if (!server) return

  return { sessionID, server }
}

// An http(s) origin is the portable form; anything else is a key only the device that made it knows.
function serverHint(value: string) {
  if (!/^https?:/i.test(value)) return SERVER_KEY.test(value) ? value : undefined
  const url = URL.parse(value)

  if (!url || url.username || url.password || url.search || url.hash) return

  if (url.pathname !== "/" && url.pathname !== "") return

  return url.origin
}
