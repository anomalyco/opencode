import { ServerConnection, sessionHref, useServers } from "@opencode/app/desktop"
import { useNavigate } from "@solidjs/router"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { sessionDeepLink } from "../../shared/session-deep-link"

const deepLinkEvent = "opencode:deep-link"

export function SessionDeepLinks() {
  const servers = useServers()
  const navigate = useNavigate()
  const [pending, setPending] = createSignal<string | undefined>()

  const take = (urls: readonly string[]) => {
    let next: string | undefined

    for (const url of urls) {
      const id = sessionDeepLink(url)

      if (id) {
        next = id

        continue
      }

      if (!sessionHost(url)) continue

      console.info("ignored invalid session deep link")
    }

    if (next) setPending(next)
  }

  onMount(() => {
    let ready = false

    const onLink = (event: Event) => {
      if (!ready) return

      // SAFETY: startDeepLinks dispatches CustomEvent detail { urls: string[] } on opencode:deep-link.
      const detail = (event as CustomEvent<{ urls?: readonly string[] }>).detail

      take(detail?.urls ?? [])
    }

    window.addEventListener(deepLinkEvent, onLink)

    const host = window.__OPENCODE__
    const queued = host?.deepLinks ?? []

    if (host) host.deepLinks = []

    ready = true
    take(queued)
    onCleanup(() => window.removeEventListener(deepLinkEvent, onLink))
  })

  createEffect(() => {
    const server = [...servers.visible, ...servers.list].find((item) => ServerConnection.local(item))
    const id = pending()

    if (!server || !id) return

    setPending(undefined)
    navigate(sessionHref(ServerConnection.key(server), id))
  })

  return null
}

function sessionHost(value: string) {
  try {
    const url = new URL(value)

    return url.protocol === "opencode:" && url.hostname === "session"
  } catch {
    return false
  }
}
