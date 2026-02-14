export const deepLinkEvent = "cyberstrike:deep-link"

export const parseDeepLink = (input: string) => {
  if (!input.startsWith("cyberstrike://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  const url = (() => {
    try {
      return new URL(input)
    } catch {
      return undefined
    }
  })()
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

type CyberStrikeWindow = Window & {
  __CYBERSTRIKE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: CyberStrikeWindow) => {
  const pending = target.__CYBERSTRIKE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__CYBERSTRIKE__) target.__CYBERSTRIKE__.deepLinks = []
  return pending
}
