export const deepLinkEvent = "opencode:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("opencode://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

export type ConnectToDeepLink = { uri: string; name?: string; request: string }

// Loopback-only: never let a deep link point the app at a remote host (rejects https,
// `127.0.0.1.evil.com` lookalikes, and embedded userinfo).
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])
const isLoopbackHttpUrl = (uri: string) => {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.protocol !== "http:") return false
  if (url.username || url.password) return false
  return LOOPBACK_HOSTS.has(url.hostname)
}

export const parseConnectToDeepLink = (input: string): ConnectToDeepLink | undefined => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname.toLowerCase() !== "connect-to") return
  const uri = url.searchParams.get("uri")
  if (!uri || !isLoopbackHttpUrl(uri)) return
  const request = url.searchParams.get("request")
  if (!request) return
  const name = url.searchParams.get("name") || undefined
  return { uri, request, ...(name ? { name } : {}) }
}

export const collectConnectToDeepLinks = (urls: string[]) =>
  urls.map(parseConnectToDeepLink).filter((link): link is ConnectToDeepLink => !!link)

type OpenCodeWindow = {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return pending
}

// Drains only connect-to links, leaving other types buffered for a handler that owns them.
export const drainConnectToDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  const mine: string[] = []
  const rest: string[] = []
  for (const url of pending) (parseConnectToDeepLink(url) ? mine : rest).push(url)
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = rest
  return mine
}
