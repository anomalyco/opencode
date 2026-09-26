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

export const parseConnectionDeepLink = (input: string) => {
  const link = parseUrl(input)
  if (link?.hostname !== "connect") return undefined
  const directory = link.searchParams.get("directory")
  const address = link.searchParams.get("url")
  if (!directory?.startsWith("/") || /[\u0000-\u001f\u007f]/.test(directory) || !address) return undefined
  try {
    const url = new URL(address)
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return undefined
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined
    if (url.port === "0") return undefined
    return { url: url.origin, directory }
  } catch {
    return undefined
  }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

type OpenCodeWindow = {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow, kind: "project" | "connection" = "project") => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  const matches = (url: string) => (parseUrl(url)?.hostname === "connect") === (kind === "connection")
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = pending.filter((url) => !matches(url))
  return pending.filter(matches)
}
