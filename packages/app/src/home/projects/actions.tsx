import { Schema } from "effect"
import { useLocation } from "@solidjs/router"
import { createSignal, onCleanup, untrack } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { toaster } from "@opencode/ui/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { isServerUnauthorized } from "@/runtime/server/health-machine"
import { useGlobal } from "@/runtime/server/runtime"
import { useSettingsSurface } from "@/settings/surface"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import type { LocalProject } from "@/shell/state/layout"
import { createProjectSessionActions } from "@/shell/tabs/project-sessions"
import {
  INITIAL_PROJECT_IMPORT_STATE,
  selectProjectImporting,
  transitionProjectImport,
  type ProjectImportEffect,
  type ProjectImportEvent,
  type ProjectImportTarget,
} from "./import-machine"
import { useRevealProject } from "./reveal"

export function createProjectActions() {
  const platform = usePlatform()

  const location = useLocation()

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
    if (conn.type !== "http" || !isServerUnauthorized(global.servers.health[ServerConnection.key(conn)]))
      return ServerConnection.authenticate(conn, () => onConnected?.(conn))
    editServer(conn, onConnected)

    return true
  }

  const directories = (project: LocalProject) => [project.worktree, ...(project.sandboxes ?? [])]

  const currentPath = () => location.pathname + location.search
  const [importState, setImportState] = createSignal(INITIAL_PROJECT_IMPORT_STATE)
  let pendingToast: number | undefined

  const dispatchImport = (event: ProjectImportEvent) => {
    const previous = untrack(importState)
    const next = transitionProjectImport(previous, event)

    if (next.state !== previous) setImportState(next.state)
    next.effects.forEach((effect) =>
      Promise.try(() => runImport(effect)).catch((cause: unknown) => console.error("[project.import]", cause)),
    )
  }

  function runImport(effect: ProjectImportEffect) {
    if (effect.type === "picker.open") {
      // Keep only the file: the picker releases its read access once the callback returns, not after the upload.
      let picked: File | undefined

      if (!platform.openAttachmentPickerDialog)
        return dispatchImport({ type: "picker.closed", attempt: effect.attempt, file: undefined })
      void platform.openAttachmentPickerDialog(
        { title: language.t("command.session.import"), accept: ["application/json"], extensions: ["json"] },
        async (file) => {
          picked = file
        },
      ).then(
        () => dispatchImport({ type: "picker.closed", attempt: effect.attempt, file: picked }),
        (cause: unknown) => dispatchImport({ type: "picker.failed", attempt: effect.attempt, cause }),
      )

      return
    }

    if (effect.type === "upload.start") {
      void upload(effect.target, effect.file).then(
        (session) =>
          dispatchImport({
            type: "import.succeeded",
            attempt: effect.attempt,
            target: effect.target,
            session,
            currentPath: untrack(currentPath),
          }),
        (cause: unknown) => dispatchImport({ type: "import.failed", attempt: effect.attempt, cause }),
      )

      return
    }

    if (effect.type === "toast.pending.show") {
      pendingToast = showToast({
        variant: "loading",
        title: language.t("toast.session.import.pending"),
        persistent: true,
      })

      return
    }

    if (effect.type === "toast.pending.dismiss") {
      if (pendingToast !== undefined) toaster.dismiss(pendingToast)
      pendingToast = undefined

      return
    }

    if (effect.type === "toast.failed")
      return showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(effect.cause, language.t("common.requestFailed")),
      })

    if (effect.type === "session.open")
      return sessions.openProjectSession(effect.target.conn, effect.target.worktree, effect.session)
    untrack(() => global.serverCtx(ServerConnection.key(effect.target.conn)))?.data.session.remember(effect.session)
  }

  async function upload(target: ProjectImportTarget, file: File) {
    const data = await Schema.decodeUnknownPromise(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)))(
      await file.text(),
    )

    const ctx = untrack(() => global.serverCtx(ServerConnection.key(target.conn)))

    if (!ctx) throw new Error(language.t("common.requestFailed"))
    const api = ctx.sdk.api.experimental.session

    // SAFETY: the import endpoint validates the transcript, including exports written by earlier releases.
    return api.import({ ...data, location: { directory: target.worktree } } as Parameters<typeof api.import>[0])
  }

  onCleanup(() => dispatchImport({ type: "disposed" }))

  return {
    authenticate,
    editServer,
    openNewSession(conn: ServerConnection.Any, directory: string) {
      if (authenticate(conn, (next) => sessions.openProjectNewSession(next, directory))) return
      sessions.openProjectNewSession(conn, directory)
    },
    canImportSession: !!platform.openAttachmentPickerDialog,
    importingSession: () => selectProjectImporting(importState()),
    importSession(conn: ServerConnection.Any, project: LocalProject) {
      dispatchImport({
        type: "import.requested",
        target: { conn, worktree: project.worktree, originPath: currentPath() },
      })
    },
    edit(conn: ServerConnection.Any, project: LocalProject) {
      settings.openProject({ server: ServerConnection.key(conn), project: project.worktree })
    },
    hasUnread(conn: ServerConnection.Any, project: LocalProject) {
      const notification = global.serverCtx(ServerConnection.key(conn))?.notification

      return !!notification && directories(project).some((directory) => notification.project.hasUnread(directory))
    },
    clearNotifications(conn: ServerConnection.Any, project: LocalProject) {
      const notification = global.serverCtx(ServerConnection.key(conn))?.notification

      directories(project).forEach((directory) => notification?.project.markViewed(directory))
    },
    hide: (conn: ServerConnection.Any, project: LocalProject) =>
      global.serverCtx(ServerConnection.key(conn))?.projects.hide(project),
    canReveal: revealProject.available,
    reveal: revealProject.reveal,
  }
}
