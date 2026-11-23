/**
 * A loopback http(s) URL's origin with `localhost`, `127.0.0.1` and `[::1]` read as one host, so two names for the
 * same port compare equal; undefined for any other URL.
 */
export function loopbackOrigin(url: string) {
  if (!URL.canParse(url)) return
  const parsed = new URL(url)

  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "[::1]") return

  return `${parsed.protocol}//127.0.0.1:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`
}

/**
 * Whether a server URL is the app's own server under any loopback name: the one rule the window (whether a server is
 * local) and the desktop's main process (whether its pages share the browser profile) both use.
 */
export function sameLoopbackServer(url: string, own: string | undefined) {
  const origin = loopbackOrigin(url)

  return !!origin && !!own && origin === loopbackOrigin(own)
}
