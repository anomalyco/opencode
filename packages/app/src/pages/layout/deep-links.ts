export const deepLinkEvent = "opencode:deep-link"

export type DeepLink =
  | { type: "open-project"; directory: string }
  | { type: "new-session"; directory: string; prompt?: string }
  | { type: "open-session"; directory: string; id: string; message?: string }
  | { type: "edit-project"; directory: string }
  | { type: "settings" }
  | { type: "server" }
  | { type: "provider" }

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
  const directory = url.searchParams.get("directory") || undefined

  if (url.hostname === "open-project") {
    if (!directory) return
    return { type: "open-project", directory } satisfies DeepLink
  }

  if (url.hostname === "new-session") {
    if (!directory) return
    const prompt = url.searchParams.get("prompt") || undefined
    if (!prompt) return { type: "new-session", directory } satisfies DeepLink
    return { type: "new-session", directory, prompt } satisfies DeepLink
  }

  if (url.hostname === "open-session") {
    if (!directory) return
    const id = url.searchParams.get("id") || undefined
    if (!id) return
    const message = url.searchParams.get("message") || undefined
    if (!message) return { type: "open-session", directory, id } satisfies DeepLink
    return { type: "open-session", directory, id, message } satisfies DeepLink
  }

  if (url.hostname === "edit-project") {
    if (!directory) return
    return { type: "edit-project", directory } satisfies DeepLink
  }

  if (url.hostname === "settings") return { type: "settings" } satisfies DeepLink
  if (url.hostname === "server") return { type: "server" } satisfies DeepLink
  if (url.hostname === "provider") return { type: "provider" } satisfies DeepLink
}

export const collectDeepLinks = (urls: string[]) => urls.map(parseDeepLink).filter((link): link is DeepLink => !!link)

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
