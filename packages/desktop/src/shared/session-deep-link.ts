const sessionId = /^[A-Za-z0-9_-]{1,256}$/
const sessionLink = /^opencode:\/\/session\/([^/?#]+)$/i

export function sessionDeepLink(value: string) {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return
  }

  if (url.protocol !== "opencode:" || url.hostname !== "session") return
  if (url.username || url.password || url.port || url.search || url.hash) return

  const raw = sessionLink.exec(value)?.[1]

  if (!raw) return

  let id: string

  try {
    id = decodeURIComponent(raw)
  } catch {
    return
  }

  if (!sessionId.test(id)) return
  if (url.pathname !== `/${raw}`) return

  return id
}
