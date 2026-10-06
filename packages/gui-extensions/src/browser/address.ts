/** Where text that is not an address goes. Shared with the system browser's default so results look familiar. */
const SEARCH = "https://www.google.com/search?q="

/**
 * What the address field navigates to for the text the user entered: the text itself when it reads as an address
 * (a scheme, `localhost`, a port, or a dotted host), else a web search for it. Main adds the missing scheme.
 */
export function resolveAddress(input: string) {
  const value = input.trim()

  if (!value) return "about:blank"

  return searches(value) ? `${SEARCH}${encodeURIComponent(value)}` : value
}

/** Whether the address field would search for the text rather than open it. */
export function searches(input: string) {
  const value = input.trim()

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^about:/i.test(value)) return false

  if (!value || /\s/.test(value)) return !!value
  const host = value.split(/[/?#]/, 1)[0] ?? ""

  return !(
    /^(?:localhost|\[[\da-f:.]+\])(?::\d+)?$/i.test(host) ||
    /:\d+$/.test(host) ||
    /^[^.]+(?:\.[^.]+)+$/.test(host)
  )
}

/**
 * The address as the field draws it at rest: always the whole URL, with its host emphasized. The parts join back to
 * exactly the text given, so the drawing lines up with the input's own text.
 */
export function addressParts(url: string) {
  const match = /^([a-z][a-z\d+.-]*:\/\/)?([^/?#]*)(.*)$/is.exec(url)

  return { scheme: match?.[1] ?? "", host: match?.[2] ?? url, rest: match?.[3] ?? "" }
}

/**
 * How a page reached its content, for the site information.
 * - `secure`: HTTPS.
 * - `local`: HTTP on a loopback host, which resolves on the machine running the server.
 * - `insecure`: HTTP elsewhere.
 * - `file`: a workspace file.
 */
export function connection(url: string) {
  if (!URL.canParse(url)) return
  const parsed = new URL(url)

  if (parsed.protocol === "https:") return "secure"

  if (parsed.protocol === "file:") return "file"

  if (parsed.protocol !== "http:") return

  return loopback(parsed.hostname) ? "local" : "insecure"
}

/** Whether a host names this machine; for a remote server that is the server's machine, not the user's. */
export function loopback(hostname: string) {
  return /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i.test(hostname) || hostname.endsWith(".localhost")
}
