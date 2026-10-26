import { createEffect, createSignal, onCleanup } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { showToast } from "@/shell/notifications/toast"
import { openNotificationSession } from "@/shell/notifications/notification"
import { rootSession } from "@/shell/routes/session"
import { useTabs } from "@/shell/tabs/tabs"
import { parseSessionLink } from "./link"
import { resolveLinkSession } from "./resolve"

const PROBE_TIMEOUT = 3_000

/** Opens `opencode://session/…` links the platform hands this window. Links only navigate. */
export function SessionLinks() {
  const platform = usePlatform()
  const language = useLanguage()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const [pending, setPending] = createSignal<string[]>([])

  onCleanup(platform.onOpenLink?.((url) => setPending((urls) => [...urls, url])) ?? (() => {}))

  createEffect(() => {
    if (!servers.hydrated() || !tabs.ready()) return
    const urls = pending()

    if (!urls.length) return
    setPending([])
    urls.forEach((url) => void open(url))
  })

  async function open(url: string) {
    const link = parseSessionLink(url)

    if (!link) return

    const found = await resolveLinkSession({
      sessionID: link.sessionID,
      hint: link.server,
      // The sidecar is asked first; it is the one most likely to have the session and the quickest to answer.
      servers: global.servers
        .list()
        .toSorted((a, b) => Number(ServerConnection.builtin(b)) - Number(ServerConnection.builtin(a)))
        .flatMap((conn) => {
          const key = ServerConnection.key(conn)
          const ctx = global.serverCtx(key)

          if (!ctx) return []

          return [
            {
              key,
              url: conn.http.url,
              get: (sessionID: string, signal: AbortSignal) => ctx.sdk.api.session.get({ sessionID }, { signal }),
            },
          ]
        }),
      timeout: PROBE_TIMEOUT,
    })

    if (!found) {
      showToast({ variant: "error", title: language.t("link.session.notFound") })

      return
    }

    const ctx = global.serverCtx(found.key)
    ctx?.data.session.remember(found.session)

    // A subagent opens in its root session's tab, routed to the subagent.
    const root = ctx
      ? await rootSession(found.session, async (sessionID) => {
          const cached = ctx.data.session.get(sessionID)

          if (cached) return cached
          const ancestor = await ctx.sdk.api.session.get({ sessionID })
          ctx.data.session.remember(ancestor)

          return ancestor
        }).catch(() => found.session)
      : found.session

    openNotificationSession(tabs, found.key, root.id, found.session)
  }

  return null
}
