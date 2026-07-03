import { makeEventListener } from "@solid-primitives/event-listener"
import { onMount } from "solid-js"
import { deepLinkEvent, drainPendingDeepLinks } from "./deep-links"

export function useDeepLinkListener(handleDeepLinks: (urls: string[]) => void) {
  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
  })
}
