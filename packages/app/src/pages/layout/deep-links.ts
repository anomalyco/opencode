export const deepLinkEvent = "weapon:deep-link"

export const parseDeepLink = (input: string) => {
  if (!input.startsWith("weapon://")) return
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

type WeaponWindow = Window & {
  __WEAPON__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: WeaponWindow) => {
  const pending = target.__WEAPON__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__WEAPON__) target.__WEAPON__.deepLinks = []
  return pending
}
