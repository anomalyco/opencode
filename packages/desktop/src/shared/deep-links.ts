// `opencode://console/authorized?window=<id>` brings back the window that started a Console sign-in. Main handles it
// itself; every other `opencode://` link goes to the app (`packages/app/src/shell/deep-links/machine.ts`).

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
