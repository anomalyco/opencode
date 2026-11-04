import { Schema } from "effect"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSettingsSurface } from "@/settings/surface"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import type { LocalProject } from "@/shell/state/layout"
import { createProjectSessionActions } from "@/shell/tabs/project-sessions"
import { useRevealProject } from "./reveal"

export function createProjectActions() {
  const platform = usePlatform()

  const dialog = useDialog()

  const language = useLanguage()

  const settings = useSettingsSurface()

  const global = useGlobal()

  const sessions = createProjectSessionActions()

  const revealProject = useRevealProject()

  function editServer(conn: ServerConnection.Http, onSave?: (saved: ServerConnection.Http) => void) {
    void import("@/servers/connect/dialog").then(({ DialogServer }) => {
      void dialog.show(() => <DialogServer mode="edit" server={conn} onSave={onSave} />)
    })
  }

  // Resume the requested action with the saved connection after an expired HTTP pairing or plugin sign-in.
  function authenticate(conn: ServerConnection.Any, onConnected?: (conn: ServerConnection.Any) => void) {
    if (conn.type !== "http" || !global.servers.health[ServerConnection.key(conn)]?.unauthorized)
      return ServerConnection.authenticate(conn, () => onConnected?.(conn))
    editServer(conn, onConnected)

    return true
  }

  const directories = (project: LocalProject) => [project.worktree, ...(project.sandboxes ?? [])]

  return {
    authenticate,
    editServer,
    openNewSession(conn: ServerConnection.Any, directory: string) {
      if (authenticate(conn, (next) => sessions.openProjectNewSession(next, directory))) return
      sessions.openProjectNewSession(conn, directory)
    },
    canImportSession: !!platform.openAttachmentPickerDialog,
    importSession(conn: ServerConnection.Any, project: LocalProject) {
      if (!platform.openAttachmentPickerDialog) return
      void platform
        .openAttachmentPickerDialog(
          { title: language.t("command.session.import"), accept: ["application/json"], extensions: ["json"] },
          async (file) => {
            const data = await Schema.decodeUnknownPromise(
              Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
            )(await file.text())

            const api = global.ensureServerCtx(conn).sdk.api.experimental.session

            // SAFETY: the import endpoint validates the transcript, including exports written by earlier releases.
            const imported = await api.import({ ...data, location: { directory: project.worktree } } as Parameters<
              typeof api.import
            >[0])

            sessions.openProjectSession(conn, project.worktree, imported)
          },
        )
        .catch((cause: unknown) => {
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          })
        })
    },
    edit(conn: ServerConnection.Any, project: LocalProject) {
      settings.openProject({ server: ServerConnection.key(conn), project: project.worktree })
    },
    hasUnread(conn: ServerConnection.Any, project: LocalProject) {
      const notification = global.ensureServerCtx(conn).notification

      return directories(project).some((directory) => notification.project.hasUnread(directory))
    },
    clearNotifications(conn: ServerConnection.Any, project: LocalProject) {
      const notification = global.ensureServerCtx(conn).notification

      directories(project).forEach((directory) => notification.project.markViewed(directory))
    },
    hide: (conn: ServerConnection.Any, project: LocalProject) => global.ensureServerCtx(conn).projects.hide(project),
    canReveal: revealProject.available,
    reveal: revealProject.reveal,
  }
}
