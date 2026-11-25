import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs } from "@/shell/tabs/tabs"
import { INITIAL_DEEP_LINK_STATE, transitionDeepLinks, type DeepLinkEffect, type DeepLinkEvent } from "./machine"

/** Opens the `opencode://` links the desktop app receives, for as long as the shell lives. */
export function useDeepLinks() {
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()

  const own = createMemo(() => servers.list.find(ServerConnection.builtin))

  // The app's own server can open projects: connected, with its project list loaded.
  const ready = createMemo(() => {
    const conn = own()
    const ctx = conn && global.serverCtx(ServerConnection.key(conn))

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

  // A project that can't be added shows the server's error (`projects.add`); one that can opens in a new session.
  const run = (effect: DeepLinkEffect) => {
    const conn = untrack(own)
    const ctx = conn && untrack(() => global.serverCtx(ServerConnection.key(conn)))

    if (!conn || !ctx) return
    const server = ServerConnection.key(conn)

    opening.last = opening.last.then(async () => {
      const project = await ctx.projects.add(effect.link.directory)

      if (!project) return

      const prompt = effect.link.type === "new-session" ? effect.link.prompt : undefined

      await tabs.newDraft({ server, directory: project.worktree }, prompt)
    })
    // A tab that failed to open must not stop the links after it.
    opening.last = opening.last.catch(() => undefined)
  }

  createEffect(() => {
    const event: DeepLinkEvent = ready() ? { type: "server.ready" } : { type: "server.lost" }
    untrack(() => dispatch(event))
  })

  const stop = platform.onDeepLinks?.((urls) => dispatch({ type: "links.received", urls }))

  if (stop) onCleanup(stop)
}
