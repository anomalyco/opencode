import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { canUseServer } from "@/runtime/server/health-machine"
import { useSettingsSurface } from "@/settings/surface"
import { useLayout } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { tabProjectDirectory } from "@/shell/tabs/project-sessions"
import { pathKey } from "@/workspaces/path-key"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { createProjectActions } from "./actions"

type StartTarget =
  | { type: "loading"; connection?: ServerConnection.Any; project?: undefined }
  | { type: "reconnect" | "add"; connection: ServerConnection.Any; project?: undefined }
  | { type: "new"; connection: ServerConnection.Any; project: Project }

export function useProjectStart() {
  const layout = useLayout()

  const global = useGlobal()

  const servers = useServers()

  const settings = useSettingsSurface()

  const language = useLanguage()

  const tabs = useTabs()

  const picker = useDirectoryPicker()

  const actions = createProjectActions()

  const target = (): StartTarget => {
    if (!tabs.restoreReady() || !layout.ready()) return { type: "loading" }
    const tab = settings.active() ? tabs.restoreTab(settings.route()) : undefined

    const last = tabs.lastTarget() ?? layout.home.selection()

    const server = tab?.server ?? last.server

    const connection = servers.visible.find((conn) => ServerConnection.key(conn) === server) ?? servers.visible[0]

    if (!connection) return { type: "loading" }
    const key = ServerConnection.key(connection)

    const ctx = global.serverCtx(key)

    if (!ctx || !ServerConnection.http(connection) || !canUseServer(global.servers.health[key]))
      return { type: "reconnect", connection }

    const used = ctx.projects.used()

    const directory = tab?.server === key ? tabProjectDirectory(ctx, tab, tabs.info[tabKey(tab)]?.directory) : undefined

    const preferred = directory ?? (last.server === key ? last.directory : undefined)

    const worktree = preferred && (ctx.projects.forDirectory(preferred)?.worktree ?? preferred)

    const selected = worktree && used.find((project) => pathKey(project.worktree) === pathKey(worktree))

    const lastID = ctx.projects.last()?.id

    const project = selected || used.find((project) => project.id === lastID) || used[0]

    if (project) return { type: "new", project, connection }

    return { type: ctx.sync.project.ready() ? "add" : "loading", connection }
  }

  const start = (draftID: string) => {
    const next = target()

    if (next.type === "loading") return false
    const conn = next.connection

    const server = ServerConnection.key(conn)

    if (next.type === "reconnect") {
      if (actions.authenticate(conn)) return false

      if (conn.type === "plugin" && conn.connect) void conn.connect().catch(() => settings.openServers(server))
      else {
        void global.servers.retry()
        settings.openServers(server)
      }

      return false
    }

    if (next.type === "new") {
      global.serverCtx(server)?.projects.touch(next.project.worktree)
      void tabs.newDraft({ server, directory: next.project.worktree, draftID })

      return true
    }

    picker({
      server: conn,
      title: language.t("session.new.project.add"),
      onSelect(result) {
        const directory = Array.isArray(result) ? result[0] : result

        if (directory) void global.serverCtx(server)?.projects.add(directory)
      },
    })

    return false
  }

  return { target, start }
}
