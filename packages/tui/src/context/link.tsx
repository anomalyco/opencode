import type { LinkTarget } from "@opencode/plugin/tui/context"
import { openUrl } from "@opencode/util/open"
import { createSimpleContext } from "./helper"

type LinkHandler = (link: LinkTarget) => boolean

export const { use: useLinks, provider: LinkProvider } = createSimpleContext({
  name: "Link",
  init: () => {
    const handlers: LinkHandler[] = []
    const claim = (link: LinkTarget) => handlers.some((handler) => handler(link))
    return {
      register(handler: LinkHandler) {
        handlers.push(handler)
        return () => {
          const index = handlers.indexOf(handler)
          if (index !== -1) handlers.splice(index, 1)
        }
      },
      claim,
      async open(url: string) {
        if (claim({ type: "url", url })) return
        await openUrl(url)
      },
    }
  },
})
