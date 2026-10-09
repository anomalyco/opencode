const sessionControl = /[\u0000-\u001f\u007f]/
const sessionLink = /^opencode:\/\/session\/([^/?#]+)$/i

export function consoleReturnWindow(value: string) {
  try {
    const url = new URL(value)

    if (url.protocol !== "opencode:" || url.hostname !== "console" || url.pathname !== "/authorized") return
    const id = url.searchParams.get("window")

    if (!id || id.length > 256 || sessionControl.test(id)) return

    return id
  } catch {
    return
  }
}

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

  if (!id || id.length > 256 || id === "." || id === "..") return
  if (id.includes("/") || id.includes("\\") || sessionControl.test(id)) return
  if (url.pathname !== `/${raw}`) return

  return id
}
