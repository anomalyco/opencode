import { base64ToBytes, bytesToBase64 } from "./base64.js"

// Pairing QR codes open this page. opencode.ai serves an apple-app-site-association file that lets the OpenCode iOS
// app claim it, so any camera app opens the code in the app. The single-use code and the server addresses ride in the
// fragment as base64url {"code","urls"} JSON, which a browser never sends to a server.
const PAGE = "https://opencode.ai/pair"

/** The https link a pairing QR code carries. */
export function pairPageLink(input: { readonly code: string; readonly urls: readonly string[] }) {
  const json = new TextEncoder().encode(JSON.stringify({ code: input.code, urls: input.urls }))
  const base64url = bytesToBase64(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")

  return `${PAGE}#${base64url}`
}

// The longest link a pairing QR code carries: QR version 11 at the lowest error correction, 61 modules wide, which
// a phone reads from a terminal and which fits beside the TUI's links. Usually four or five addresses.
const QR_LINK_BYTES = 321

/**
 * The link for a pairing QR code: the reachable addresses that fit, in their original order, or undefined when there
 * are none or not even one fits. A machine with many network interfaces (container bridges, for instance) lists more
 * addresses than a scannable code holds, so the remote access address and the likeliest networks go in first.
 */
export function pairingQRLink(code: string, urls: readonly string[]) {
  const all = reachableURLs(urls)
  // Likely container bridges and link-local addresses only go in when nothing likelier does.
  const likely = all.filter((url) => rank(url) < UNLIKELY)
  const reachable = likely.length ? likely : all
  const kept = new Set<string>()

  for (const url of reachable.toSorted((a, b) => rank(a) - rank(b))) {
    kept.add(url)
    // The link is ASCII, so its length is its size in bytes.
    if (link().length > QR_LINK_BYTES) kept.delete(url)
  }

  return kept.size ? link() : undefined

  function link() {
    return pairPageLink({ code, urls: reachable.filter((url) => kept.has(url)) })
  }
}

const UNLIKELY = 5

// Lower first: the remote access address works anywhere, a tailnet address off the local network, and 172.16.0.0/12
// is where Docker and most container runtimes put their bridges.
function rank(value: string) {
  const url = parse(value)
  if (!url) return UNLIKELY
  if (url.protocol === "https:") return 0
  const octets = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(url.hostname)?.slice(1).map(Number)
  if (octets?.[0] === 100 && octets[1] >= 64 && octets[1] < 128) return 1
  if (octets?.[0] === 192 && octets[1] === 168) return 2
  if (octets?.[0] === 10) return 3
  if (octets?.[0] === 172 && octets[1] >= 16 && octets[1] < 32) return UNLIKELY
  if (url.hostname.startsWith("[fe80:")) return UNLIKELY
  return 4
}

/** The server addresses another device can reach: loopback addresses are useless to the device scanning the code. */
export function reachableURLs(urls: readonly string[]) {
  return urls.filter((value) => {
    const hostname = parse(value)?.hostname

    return (
      hostname !== undefined &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !hostname.startsWith("127.") &&
      hostname !== "[::1]"
    )
  })
}

/** The {"code","urls"} JSON a pair page link carries, unvalidated, or undefined for any other text. */
export function pairPagePayload(value: string) {
  const url = parse(value.trim())

  if (!url || url.origin !== new URL(PAGE).origin || (url.pathname !== "/pair" && url.pathname !== "/pair/")) return
  if (url.username || url.password || url.search) return
  const fragment = url.hash.slice(1)

  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(fragment)) return
  const base64 = fragment.replace(/=+$/, "").replaceAll("-", "+").replaceAll("_", "/")

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      base64ToBytes(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
    )
  } catch {
    return
  }
}

// URL.parse is missing from Safari before 18.
function parse(value: string) {
  try {
    return new URL(value)
  } catch {
    return
  }
}
