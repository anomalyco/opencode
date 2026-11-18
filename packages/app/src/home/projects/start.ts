import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { canUseServer } from "@/runtime/server/health-machine"
import { useSettingsSurface } from "@/settings/surface"
import { useLayout } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { tabProjectDirectory } from "@/shell/tabs/project-sessions"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { createProjectActions } from "./actions"

type StartTarget =
  | { type: "loading"; connection?: ServerConnection.Any; project?: undefined }
  | { type: "reconnect" | "add"; connection: ServerConnection.Any; project?: undefined }
  | { type: "new"; connection: ServerConnection.Any; project: Project; directory: string }

/** A selected sibling clone keeps its directory; the server's canonical project still supplies the identity. */
export function resolveStartProject(
  preferred: string | undefined,
  forDirectory: (directory: string) => Project | undefined,
  used: readonly Project[],
  last: Project | undefined,
  selected?: Project,
) {
  const matched = preferred ? forDirectory(preferred) : undefined
  const byPath = matched && used.find((item) => item.id === matched.id)
  const bySelection = selected && used.find((item) => item.id === selected.id)
  const project = byPath ?? bySelection ?? last ?? used[0]

  if (!project) return

  return { directory: preferred && (byPath || bySelection) ? preferred : project.worktree, project }
}

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

    const lastUsed = ctx.projects.last()

    const projectID = last.server === key && "projectID" in last ? last.projectID : undefined

    const selected = projectID ? used.find((project) => project.id === projectID) : undefined

    const resolved = resolveStartProject(
      preferred,
      (directory) => ctx.projects.forDirectory(directory),
      used,
      lastUsed && used.find((project) => project.id === lastUsed.id),
      selected,
    )

    if (resolved) return { type: "new", project: resolved.project, directory: resolved.directory, connection }

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
      global.serverCtx(server)?.projects.touch(next.directory)
      void tabs.newDraft({ server, directory: next.directory, draftID })

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
