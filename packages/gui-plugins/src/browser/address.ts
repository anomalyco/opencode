import { destinationOrigin, localAddress } from "./policy"

/** Where text that is not an address goes. Shared with the system browser's default so results look familiar. */
const SEARCH = "https://www.google.com/search?q="

/**
 * What the address field navigates to for the text the user entered: the text itself when it reads as an address
 * (a scheme, `localhost`, a port, or a dotted host), else a web search for it. Main adds the missing scheme.
 */
export function resolveAddress(input: string) {
  const value = input.trim()

  if (!value || value.toLowerCase() === "about:blank") return "about:blank"

  return searches(value) ? searchAddress(value) : value
}

/** The web search for a text, which the address field's list offers for any text, an address too. */
export function searchAddress(text: string) {
  return `${SEARCH}${encodeURIComponent(text.trim())}`
}

/**
 * Whether the address field would search for the text rather than open it. A typed scheme means an address, which
 * main opens or explains why not; it searches only when the text is no URL at all, such as a bare `https://`. Text
 * without one is an address when it names a host main opens as a web page.
 */
export function searches(input: string) {
  const value = input.trim()

  if (!value || /^about:\S*$/i.test(value)) return false

  if (localAddress(value) || value.startsWith("//")) return false

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return !URL.canParse(value)

  if (/\s/.test(value)) return true
  const host = value.split(/[/?#]/, 1)[0] ?? ""

  const named =
    /^(?:localhost|\[[\da-f:.]+\])(?::\d+)?$/i.test(host) || /:\d+$/.test(host) || /^[^.]+(?:\.[^.]+)+$/.test(host)

  // Main adds the scheme the same way, so the text opens only if the whole URL it becomes does.
  return !named || !destinationOrigin(`https://${value}`)
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
 * - `workspace`: a file read by the session's server, not from the desktop's disk.
 */
export function connection(url: string) {
  if (!URL.canParse(url)) return
  const parsed = new URL(url)

  if (parsed.protocol === "https:") return "secure"

  if (parsed.protocol === "file:") return "file"

  if (parsed.protocol === "workspace:") return "workspace"

  if (parsed.protocol !== "http:") return

  return loopback(parsed.hostname) ? "local" : "insecure"
}

/** Whether a host names this machine; for a remote server that is the server's machine, not the user's. */
export function loopback(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "")

  // URL.hostname canonicalizes IPv4-mapped IPv6 into hex groups, including mapped 0.0.0.0.
  return /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|::1|\[::ffff:(?:7f[\da-f]{2}:[\da-f]{1,4}|0:0)\])$/.test(host) || host.endsWith(".localhost")
}

/** A file never goes to the default application. Main resolves the tab's workspace again before revealing it. */
export function externalAction(url: string, local: boolean) {
  if (!URL.canParse(url)) return
  const parsed = new URL(url)

  if (parsed.protocol === "file:") return local && !parsed.hostname ? "reveal" : undefined

  if (destinationOrigin(url) && (local || !loopback(parsed.hostname))) return "browser"
}

/** Eligibility of the displayed page; only main can turn a preview grant into a launchable file. */
export function externalPage(url: string, local: boolean) {
  const action = externalAction(url, local)

  return action === "browser" || (action === "reveal" && /\.html?$/i.test(new URL(url).pathname))
}

/** `shown` is main's committed address or the URL Chromium reported failing, never a renderer-supplied target. */
export function pageHandoff(actual: string, display: string, shown: string, failed: boolean, local: boolean) {
  if (externalAction(shown, local) === "browser" && (failed || actual === shown)) return { kind: "web" as const, url: shown }

  if (!failed && actual.startsWith("oc-preview://") && display === shown && shown.startsWith("file:") && externalPage(shown, local))
    return { kind: "preview" as const, url: shown }
}
