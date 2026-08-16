export const deepLinkEvent = "opencode:deep-link"

export type ConnectIntent = {
  server: string
  directory?: string
}

const parseUrl = (input: string) => {
  if (!input.startsWith("opencode://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

const parseConnectParams = (params: URLSearchParams): ConnectIntent | undefined => {
  const input = params.get("server")?.trim()
  if (!input) return
  try {
    const server = new URL(input)
    if (server.protocol !== "http:" && server.protocol !== "https:") return
    if (server.username || server.password || server.search || server.hash) return
    const directory = params.get("directory")?.trim() || undefined
    if (directory && !/^(?:~(?:[\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\)/.test(directory)) return
    return { server: server.toString().replace(/\/+$/, ""), directory }
  } catch {
    return
  }
}

export const parseConnectIntent = (input: string) => {
  if (input.startsWith("opencode://")) {
    const url = parseUrl(input)
    if (!url || url.hostname !== "connect") return
    return parseConnectParams(url.searchParams)
  }

  try {
    const url = new URL(input)
    const match = url.hash.match(/^#connect(?:\?(.*))?$/)
    if (!match) return
    return parseConnectParams(new URLSearchParams(match[1] ?? ""))
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

export const collectConnectIntents = (urls: string[]) =>
  urls.map(parseConnectIntent).filter((intent): intent is ConnectIntent => !!intent)

type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  return takePendingDeepLinks(target, () => true)
}

export const takePendingDeepLinks = (target: OpenCodeWindow, matches: (input: string) => boolean) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  const selected = pending.filter(matches)
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = pending.filter((input) => !matches(input))
  return selected
}
