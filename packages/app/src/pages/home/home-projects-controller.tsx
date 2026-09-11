import { useDirectoryPicker } from "@/components/directory-picker"
import { useServerManagementController } from "@/components/dialog-select-server"
import { useSettingsCommand } from "@/components/settings-dialog"
import { DialogServerV2 } from "@/components/settings-v2/dialog-server-v2"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { closeHomeProject, displayName, errorMessage, homeProjectDirectories } from "@/pages/layout/helpers"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { batch, createResource } from "solid-js"
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
  const [_state, setState, _, ready] = persisted(
    Persist.global("home.servers", ["home.servers.v1"]),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (promise) => promise.then(() => _state),
    { initialValue: _state },
  )
  function directories(project: LocalProject) {
    return [project.worktree, ...(project.sandboxes ?? [])]
  }

  function canRevealProject(conn: ServerConnection.Any) {
    return platform.platform === "desktop" && !!platform.openPath && ServerConnection.local(conn)
  }

  function confirmForgetClosed(projects: LocalProject[], onConfirm: () => void) {
    const single = projects.length === 1 ? projects[0] : undefined
    const title = single
      ? language.t("home.recentlyClosed.remove.title")
      : language.t("home.recentlyClosed.remove.titleMany", { count: projects.length })
    const description = single
      ? language.t("home.recentlyClosed.remove.confirm", { name: displayName(single) })
      : language.t("home.recentlyClosed.remove.confirmMany", { count: projects.length })
    void Promise.all([import("@opencode-ai/ui/v2/dialog-v2"), import("@opencode-ai/ui/v2/button-v2")]).then(
      ([{ DialogV2, DialogHeader, DialogTitleGroup, DialogFooter }, { ButtonV2 }]) =>
        dialog.show(() => (
          <DialogV2 fit>
            <DialogHeader hideClose>
              <DialogTitleGroup title={title} description={description} />
            </DialogHeader>
            <DialogFooter>
              <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2
                variant="danger"
                data-action="recently-closed-confirm-remove"
                onClick={() => {
                  dialog.close()
                  onConfirm()
                }}
              >
                {language.t("home.recentlyClosed.action.remove")}
              </ButtonV2>
            </DialogFooter>
          </DialogV2>
        )),
    )
  }

  // Archiving and hiding take entries out of the default view, so both get a toast with undo.
  function flagClosed(
    conn: ServerConnection.Any,
    directories: string[],
    apply: "archiveClosed" | "hideClosed",
    revert: "unarchiveClosed" | "unhideClosed",
    title: string,
  ) {
    const projects = home.server.context(conn).projects
    batch(() => directories.forEach((directory) => projects[apply](directory)))
    showToast({
      title,
      actions: [
        {
          label: language.t("home.recentlyClosed.toast.undo"),
          onClick: () => batch(() => directories.forEach((directory) => projects[revert](directory))),
        },
      ],
    })
  }

  return {
    copy: {
      language,
    },
    selection: {
      value: home.selection.value,
    },
    server: {
      list: home.server.list,
      health: home.server.health,
      projects: home.project.forServer,
      collapsed: (conn: ServerConnection.Any) => state().collapsed[ServerConnection.key(conn)] ?? false,
      toggleCollapsed: (conn: ServerConnection.Any) => {
        const key = ServerConnection.key(conn)
        setState("collapsed", key, !state().collapsed[key])
      },
      canDefault: serverManagement.canDefault,
      defaultKey: serverManagement.defaultKey,
      setDefault: (conn: ServerConnection.Any | undefined) =>
        serverManagement.setDefault(conn ? ServerConnection.key(conn) : null),
      remove: (conn: ServerConnection.Any) => serverManagement.handleRemove(ServerConnection.key(conn)),
      edit: (conn: ServerConnection.Http) => dialog.show(() => <DialogServerV2 mode="edit" server={conn} />),
      focus: home.selection.focusServer,
    },
    project: {
      list: home.project.list,
      recentlyClosed: home.project.recentlyClosed,
      closedForServer: home.project.closedForServer,
      isHiddenClosed: (conn: ServerConnection.Any, directory: string) =>
        home.server.context(conn).projects.isHiddenClosed(directory),
      isArchivedClosed: (conn: ServerConnection.Any, directory: string) =>
        home.server.context(conn).projects.isArchivedClosed(directory),
      homedir: home.project.homedir,
      select: home.project.select,
      add: home.project.add,
      openNewSession: home.project.openProjectNewSession,
      reopenClosed: (conn: ServerConnection.Any, directories: string[]) => {
        if (home.server.health(conn)?.healthy === false) return
        home.project.add(conn, directories)
      },
      archiveClosed: (conn: ServerConnection.Any, directories: string[]) =>
        flagClosed(
          conn,
          directories,
          "archiveClosed",
          "unarchiveClosed",
          language.t("home.recentlyClosed.toast.archived"),
        ),
      unarchiveClosed: (conn: ServerConnection.Any, directories: string[]) => {
        const projects = home.server.context(conn).projects
        batch(() => directories.forEach((directory) => projects.unarchiveClosed(directory)))
      },
      hideClosed: (conn: ServerConnection.Any, directories: string[]) =>
        flagClosed(conn, directories, "hideClosed", "unhideClosed", language.t("home.recentlyClosed.toast.hidden")),
      unhideClosed: (conn: ServerConnection.Any, directories: string[]) => {
        const projects = home.server.context(conn).projects
        batch(() => directories.forEach((directory) => projects.unhideClosed(directory)))
      },
      removeClosed: (conn: ServerConnection.Any, items: LocalProject[]) => {
        const projects = home.server.context(conn).projects
        confirmForgetClosed(items, () => {
          const directories = items.map((project) => project.worktree)
          batch(() => directories.forEach((directory) => projects.removeClosed(directory)))
          showToast({
            title: language.t("home.recentlyClosed.toast.removed"),
            actions: [
              {
                label: language.t("home.recentlyClosed.toast.undo"),
                // Re-record oldest first so the entries land on top of history in their original
                // order. Anything reopened in the meantime is left open.
                onClick: () =>
                  batch(() =>
                    directories.toReversed().forEach((directory) => {
                      if (projects.list().some((project) => project.worktree === directory)) return
                      projects.close(directory)
                    }),
                  ),
              },
            ],
          })
        })
      },
      edit: (conn: ServerConnection.Any, project: LocalProject) => {
        void import("@/components/dialog-edit-project-v2").then(({ DialogEditProjectV2 }) => {
          void dialog.show(() => <DialogEditProjectV2 server={conn} project={project} />)
        })
      },
      unseenCount: (conn: ServerConnection.Any, project: LocalProject) => {
        const state = notification.ensureServerState(ServerConnection.key(conn))
        return directories(project).reduce((total, directory) => total + state.project.unseenCount(directory), 0)
      },
      clearNotifications: (conn: ServerConnection.Any, project: LocalProject) => {
        const state = notification.ensureServerState(ServerConnection.key(conn))
        directories(project)
          .filter((directory) => state.project.unseenCount(directory) > 0)
          .forEach((directory) => state.project.markViewed(directory))
      },
      choose: (conn: ServerConnection.Any) => {
        if (home.server.health(conn)?.healthy === false) return
        pickDirectory({
          server: conn,
          title: language.t("command.project.open"),
          multiple: true,
          onSelect: (result) => home.project.add(conn, homeProjectDirectories(result)),
        })
      },
      close: (conn: ServerConnection.Any, directory: string) => {
        const next = closeHomeProject(
          home.selection.value(),
          ServerConnection.key(conn),
          home.server.context(conn).projects,
          directory,
        )
        if (next) home.selection.set(next)
      },
      move: (conn: ServerConnection.Any, worktree: string, index: number) => {
        home.server.context(conn).projects.move(worktree, index)
      },
      canReveal: canRevealProject,
      reveal: (conn: ServerConnection.Any, project: LocalProject) => {
        if (!platform.openPath || !canRevealProject(conn)) return
        platform.openPath(project.worktree).catch((cause: unknown) =>
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          }),
        )
      },
    },
    utility: {
      settings: openSettings,
      help: () => platform.openExternal("https://opencode.ai/desktop-feedback"),
    },
  }
}

export type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
