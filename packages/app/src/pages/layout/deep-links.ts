export const deepLinkEvent = "opencode:deep-link"

const parseUrl = (input: string) => {
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    const url = new URL(input)
    if (url.protocol !== "opencode:") return
    return url
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

export const existingSessionDeepLink = (server: string, session: string) => {
  const url = new URL("opencode://open-session")
  url.searchParams.set("server", server)
  url.searchParams.set("session", session)
  return url.toString()
}

export const parseExistingSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-session" || (url.pathname !== "" && url.pathname !== "/")) return
  const server = url.searchParams.get("server")
  const session = url.searchParams.get("session")
  if (!server || !session) return
  return { server, session }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

export const collectExistingSessionDeepLinks = (urls: string[]) =>
  urls.map(parseExistingSessionDeepLink).filter((link): link is { server: string; session: string } => !!link)

export const lastDeepLink = (urls: string[]) =>
  urls
    .filter((url) => !!parseDeepLink(url) || !!parseNewSessionDeepLink(url) || !!parseExistingSessionDeepLink(url))
    .at(-1)

let deepLinkQueue = Promise.resolve()

export const enqueueDeepLink = (task: () => void | Promise<void>) => {
  const next = deepLinkQueue.then(task, task)
  deepLinkQueue = next.then(
    () => {},
    () => {},
  )
  return next
}

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

export const takePendingDeepLink = (target: OpenCodeWindow, take: (url: string) => boolean) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  const selected = lastDeepLink(pending)
  if (!selected) {
    if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
    return
  }
  if (!take(selected)) return
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return selected
}
