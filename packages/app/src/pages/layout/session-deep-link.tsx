import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { useServer } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import { collectSessionDeepLinks, deepLinkEvent } from "./deep-links"

export function SessionDeepLinks() {
  const server = useServer()
  const navigate = useNavigate()

  const open = (urls: readonly string[]) => {
    if (!server.isLocal()) return
    for (const id of collectSessionDeepLinks([...urls])) navigate(sessionHref(server.key, id))
  }

  onMount(() => {
    const host = window as Window & { __OPENCODE__?: { deepLinks?: string[] } }
    const queued = host.__OPENCODE__?.deepLinks ?? []
    open(queued)
    makeEventListener(window, deepLinkEvent, ((event: Event) => {
      const detail = (event as CustomEvent<{ urls?: readonly string[] }>).detail
      open(detail?.urls ?? [])
    }) as EventListener)
  })

  return null
}
