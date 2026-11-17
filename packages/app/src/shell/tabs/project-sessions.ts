import { startTransition } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs, type Tab } from "./tabs"

// A linked worktree can live outside the project's root directory.
export function tabProjectDirectory(ctx: ServerCtx | undefined, tab: Tab, cached?: string, routedID?: string) {
  const session =
    tab.type === "session" ? ctx?.data.session.get(routedID ?? tab.routeSessionId ?? tab.sessionId) : undefined

  const directory = tab.type === "draft" ? tab.directory : (session?.location.directory ?? cached)

  if (!directory) return

  return (
    (session && ctx?.projects.forSession(session)?.worktree) ||
    ctx?.data.location.info({ directory })?.project.canonical ||
    ctx?.projects.forDirectory(directory)?.worktree ||
    directory
  )
}

export function createProjectSessionActions() {
  const global = useGlobal()

  const tabs = useTabs()

  return {
    openProjectNewSession(conn: ServerConnection.Any, directory: string) {
      global.serverCtx(ServerConnection.key(conn))?.projects.touch(directory)
      void tabs.newDraft({ server: ServerConnection.key(conn), directory })
    },
    openProjectSession(
      conn: ServerConnection.Any,
      directory: string,
      session: SessionInfo,
      options?: { preview?: boolean },
    ) {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      if (!ctx) return
      void ctx.data.session.message.sync(session.id).catch(() => undefined)
      void startTransition(() => {
        ctx.data.session.remember(ctx.data.session.get(session.id) ?? session)
        ctx.projects.touch(directory)

        if (options?.preview) {
          tabs.previewSession({ server: ServerConnection.key(conn), sessionId: session.id })

          return
        }

        const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })

        tabs.select(tab)
      })
    },
  }
}
