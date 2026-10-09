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

const sessionControl = /[\u0000-\u001f\u007f]/
const sessionLink = /^opencode:\/\/session\/([^/?#]+)$/i

export const parseSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.protocol !== "opencode:" || url.hostname !== "session") return
  if (url.username || url.password || url.port || url.search || url.hash) return
  const raw = sessionLink.exec(input)?.[1]
  if (!raw) return
  let id: string
  try {
    id = decodeURIComponent(raw)
  } catch {
    return
  }
  if (!id || id.length > 256 || id === "." || id === "..") return
  if (id.includes("/") || id.includes("\\") || sessionControl.test(id)) return
  if (url.pathname !== `/${raw}`) return
  return id
}

export const collectSessionDeepLinks = (urls: string[]) =>
  urls.map(parseSessionDeepLink).filter((id): id is string => !!id)

type OpenCodeWindow = Window & {
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
