import { useDirectoryPicker } from "@/components/directory-picker"
import { useServerManagementController } from "@/components/dialog-select-server"
import { useSettingsCommand } from "@/components/settings-dialog"
import { DialogServerV2 } from "@/components/settings-v2/dialog-server-v2"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { closeHomeProject, errorMessage, homeProjectDirectories } from "@/pages/layout/helpers"
import { fileManagerApp } from "@/utils/file-manager"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import type { HomeController } from "./home-controller"

export function createHomeProjectsController(home: HomeController) {
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const language = useLanguage()
  const notification = useNotification()
  const openSettings = useSettingsCommand()
  const serverManagement = useServerManagementController({ navigateOnAdd: false })
  const [menu, setMenu] = createStore({ open: undefined as string | undefined })
  const [_state, setState, _, ready] = persisted(
    Persist.global("home.servers", ["home.servers.v1"]),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (promise) => promise.then(() => _state),
    { initialValue: _state },
  )
  createEffect(() => {
    const id = menu.open
    if (!id) return
    const connections = home.servers()
    const valid = connections.some((conn) => {
      if (serverMenuID(conn) === id) return true
      if (connections.length > 1 && (home.serverHealth(conn)?.healthy !== true || collapsed(conn))) return false
      const list = connections.length === 1 ? home.projects() : home.projectsForServer(conn)
      return list.some((project) => projectMenuID(conn, project.worktree) === id)
    })
    if (!valid) setMenu("open", undefined)
  })

  function editProject(conn: ServerConnection.Any, project: LocalProject) {
    void import("@/components/dialog-edit-project-v2").then(({ DialogEditProjectV2 }) => {
      void dialog.show(() => <DialogEditProjectV2 server={conn} project={project} />)
    })
  }

  function directories(project: LocalProject) {
    return [project.worktree, ...(project.sandboxes ?? [])]
  }

  function unseenCount(conn: ServerConnection.Any, project: LocalProject) {
    const state = notification.ensureServerState(ServerConnection.key(conn))
    return directories(project).reduce((total, directory) => total + state.project.unseenCount(directory), 0)
  }

  function clearNotifications(conn: ServerConnection.Any, project: LocalProject) {
    const state = notification.ensureServerState(ServerConnection.key(conn))
    directories(project)
      .filter((directory) => state.project.unseenCount(directory) > 0)
      .forEach((directory) => state.project.markViewed(directory))
  }

  function chooseProject(conn: ServerConnection.Any) {
    if (home.serverHealth(conn)?.healthy === false) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => home.addProjects(conn, homeProjectDirectories(result)),
    })
  }

  function closeProject(conn: ServerConnection.Any, directory: string) {
    const next = closeHomeProject(
      home.selection(),
      ServerConnection.key(conn),
      home.serverContext(conn).projects,
      directory,
    )
    if (next) home.setSelection(next)
  }

  function moveProject(conn: ServerConnection.Any, worktree: string, index: number) {
    home.serverContext(conn).projects.move(worktree, index)
  }

  function revealProject(conn: ServerConnection.Any, project: LocalProject) {
    if (!platform.openPath || !canRevealProject(conn)) return
    platform.openPath(project.worktree).catch((cause: unknown) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      }),
    )
  }

  function canRevealProject(conn: ServerConnection.Any) {
    return platform.platform === "desktop" && !!platform.openPath && ServerConnection.local(conn)
  }

  function collapsed(conn: ServerConnection.Any) {
    return state().collapsed[ServerConnection.key(conn)] ?? false
  }

  function serverMenuID(conn: ServerConnection.Any) {
    return `server:${ServerConnection.key(conn)}`
  }

  function projectMenuID(conn: ServerConnection.Any, directory: string) {
    return `project:${ServerConnection.key(conn)}:${directory}`
  }

  return {
    language,
    selection: home.selection,
    projects: home.projects,
    recentlyClosed: home.recentlyClosed,
    homedir: home.homedir,
    servers: home.servers,
    serverHealth: home.serverHealth,
    projectsForServer: home.projectsForServer,
    collapsed,
    toggleCollapsed: (conn: ServerConnection.Any) => {
      const key = ServerConnection.key(conn)
      setState("collapsed", key, !state().collapsed[key])
    },
    menuOpen: (id: string) => menu.open === id,
    setMenuOpen: (id: string, open: boolean) => setMenu("open", open ? id : undefined),
    serverMenuID,
    projectMenuID,
    canDefaultServer: serverManagement.canDefault,
    isDefaultServer: (conn: ServerConnection.Any) => serverManagement.defaultKey() === ServerConnection.key(conn),
    setDefaultServer: (conn: ServerConnection.Any | undefined) =>
      serverManagement.setDefault(conn ? ServerConnection.key(conn) : null),
    removeServer: (conn: ServerConnection.Any) => serverManagement.handleRemove(ServerConnection.key(conn)),
    openEditServer: (conn: ServerConnection.Http) => dialog.show(() => <DialogServerV2 mode="edit" server={conn} />),
    focusServer: home.focusServer,
    selectProject: home.selectProject,
    addProjects: home.addProjects,
    openProjectNewSession: home.openProjectNewSession,
    editProject,
    unseenCount,
    clearNotifications,
    chooseProject,
    closeProject,
    moveProject,
    canRevealProject,
    revealProject,
    fileManagerActionLabel: () =>
      language.t(fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown").actionLabel),
    openSettings,
    openHelp: () => platform.openLink("https://opencode.ai/desktop-feedback"),
  }
}

export type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
