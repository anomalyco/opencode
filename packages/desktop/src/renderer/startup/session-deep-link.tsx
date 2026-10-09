import { ServerConnection, sessionHref, useServers } from "@opencode/app/desktop"
import { useNavigate } from "@solidjs/router"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { sessionDeepLink } from "../../main/lifecycle/deep-link"

const deepLinkEvent = "opencode:deep-link"

export function SessionDeepLinks() {
  const servers = useServers()
  const navigate = useNavigate()
  const [pending, setPending] = createSignal<string[]>([])

  const take = (urls: readonly string[]) => {
    const ids: string[] = []

    for (const url of urls) {
      const id = sessionDeepLink(url)

      if (id) {
        ids.push(id)

        continue
      }

      if (!sessionHost(url)) continue

      console.info("ignored invalid session deep link")
    }

    if (ids.length === 0) return

    setPending((current) => [...current, ...ids])
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
    const server = servers.visible[0] ?? servers.list[0]
    const ids = pending()

    if (!server || ids.length === 0) return

    setPending([])

    const key = ServerConnection.key(server)

    for (const id of ids) navigate(sessionHref(key, id))
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
