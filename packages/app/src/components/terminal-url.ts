export function ptySocketUrl(base: string, id: string, directory: string, origin: { host: string; protocol: string }) {
  const root = `${origin.protocol}//${origin.host}`
  const current = new URL(root)
  const prefix = /^https?:\/\//.test(base) ? base : new URL(base || "/", root).toString()
  const url = new URL(prefix.replace(/\/+$/, "") + `/pty/${id}/connect?directory=${encodeURIComponent(directory)}`)
  url.hostname = current.hostname
  url.port = current.port
  url.protocol = origin.protocol === "https:" ? "wss:" : "ws:"
  return url
}
