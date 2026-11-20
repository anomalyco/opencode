import type { LinkTarget } from "@opencode/plugin/tui/context"
import { openPath, openUrl } from "@opencode/util/open"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"

type LinkHandler = (link: LinkTarget) => boolean

export function createLinkRegistry() {
  let registrations: { handler: LinkHandler }[] = []
  const claim = (link: LinkTarget) => registrations.some((registration) => registration.handler(link))
  return {
    register(handler: LinkHandler) {
      const registration = { handler }
      registrations = [...registrations, registration]
      return () => {
        registrations = registrations.filter((item) => item !== registration)
      }
    },
    claim,
    async openUrl(url: string) {
      if (claim({ type: "url", url })) return
      await openUrl(url)
    },
    async openPath(path: string) {
      if (claim({ type: "path", path })) return
      await openPath(path)
    },
  }
}

export const { use: useLinks, provider: LinkProvider } = createSimpleContext({
  name: "Link",
  init: () => createLinkRegistry(),
})

export function useOpenSession() {
  const links = useLinks()
  const route = useRoute()
  return (sessionID: string) => {
    if (links.claim({ type: "session", sessionID })) return
    route.navigate({ type: "session", sessionID })
  }
}
