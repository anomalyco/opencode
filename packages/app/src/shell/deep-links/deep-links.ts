import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import { usePluginServers } from "@/runtime/plugin/servers"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs } from "@/shell/tabs/tabs"
import {
  INITIAL_DEEP_LINK_STATE,
  transitionDeepLinks,
  type DeepLink,
  type DeepLinkEffect,
  type DeepLinkEvent,
} from "./machine"

/** Opens the `opencode://` links the desktop app receives, for as long as the shell lives. */
export function useDeepLinks() {
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const pluginServers = usePluginServers()

  const own = createMemo(() => servers.list.find(ServerConnection.builtin))

  // The app's own server can open projects: connected, with its project list loaded. Tabs opened before the window's
  // tabs hydrate would be replaced by them, and a session lookup can only reach plugin servers once they're listed.
  const ready = createMemo(() => {
    const conn = own()
    const ctx = conn && global.serverCtx(ServerConnection.key(conn))

    if (!tabs.ready() || !pluginServers.ready()) return false

    return !!ctx && ctx.sdk.connection.status() === "connected" && ctx.sync.project.ready()
  })

  const machine = { state: INITIAL_DEEP_LINK_STATE }

  const dispatch = (event: DeepLinkEvent) => {
    const next = transitionDeepLinks(machine.state, event)
    machine.state = next.state
    next.effects.forEach(run)
  }

  // Each link opens after the one before it, so the tabs open in the order the links came and the last one is in front.
  const opening = { last: Promise.resolve() }

  const run = (effect: DeepLinkEffect) => {
    const conn = untrack(own)

    if (!conn) return
    const server = ServerConnection.key(conn)

    opening.last = opening.last.then(() => open(server, effect.link))
    // A tab that failed to open must not stop the links after it.
    opening.last = opening.last.catch((error) => console.error("[deep-links] failed to open", error))
  }

  const open = async (own: ServerConnection.Key, link: DeepLink) => {
    if (link.type === "session") return openSession(own, link.sessionID)
    const ctx = untrack(() => global.serverCtx(own))

    if (!ctx) return
    // A project that can't be added shows the server's error (`projects.add`); one that can opens in a new session.
    const project = await ctx.projects.add(link.directory)

    if (!project) return

    const prompt = link.type === "new-session" ? link.prompt : undefined

    await tabs.newDraft({ server: own, directory: project.worktree }, prompt)
  }

  // The app's own server first, then the others in list order; the first that has the session opens it.
  const openSession = async (own: ServerConnection.Key, sessionID: string) => {
    const others = untrack(() => servers.list)
      .map(ServerConnection.key)
      .filter((key) => key !== own)

    for (const key of [own, ...others]) {
      const api = untrack(() => global.serverCtx(key))?.sdk.api

      if (!api) continue

      const found = await api.session.get({ sessionID }).then(
        () => true,
        () => false,
      )

      if (found) return tabs.select(tabs.addSessionTab({ server: key, sessionId: sessionID }))
    }

    console.warn("[deep-links] no server has session", sessionID)
  }

  createEffect(() => {
    const event: DeepLinkEvent = ready() ? { type: "server.ready" } : { type: "server.lost" }
    untrack(() => dispatch(event))
  })

  const stop = platform.onDeepLinks?.((urls) => dispatch({ type: "links.received", urls }))

  if (stop) onCleanup(stop)
}
