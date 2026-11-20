// The `opencode://` links Desktop handles:
// - `opencode://session/<id>` opens a session from the local server, else the first other server that has it.
// - `opencode://console/authorized?window=<id>` brings back the window that started a Console sign-in.

export function sessionDeepLink(value: string) {
  const url = parseDeepLink(value)

  if (url?.hostname !== "session") return
  const id = url.pathname.slice(1)

  if (!id.startsWith("ses") || id.includes("/")) return

  return id
}

export function consoleReturnWindow(value: string) {
  const url = parseDeepLink(value)

  if (url?.hostname !== "console" || url.pathname !== "/authorized") return
  const id = url.searchParams.get("window")

  if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return

  return id
}

function parseDeepLink(value: string) {
  if (!URL.canParse(value)) return
  const url = new URL(value)

  if (url.protocol !== "opencode:") return

  return url
}
