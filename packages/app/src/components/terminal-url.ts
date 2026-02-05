export function ptySocketUrl(base: string, id: string, directory: string, origin: { host: string; protocol: string }) {
  const root = `${origin.protocol}//${origin.host}`
  const absolute = /^https?:\/\//.test(base)
  const resolved = absolute ? new URL(base) : new URL(base || "/", root)

  const url = new URL(resolved)
  url.pathname = resolved.pathname.replace(/\/+$/, "") + `/pty/${id}/connect`
  url.search = ""
  url.searchParams.set("directory", directory)
  url.protocol = resolved.protocol === "https:" ? "wss:" : "ws:"
  return url
}
