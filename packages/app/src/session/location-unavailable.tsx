import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer, useData } from "@/runtime/server/current"
import { formatProjectLocationError, formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { closeHomeProject, projectForSession } from "@/shell/layout/helpers"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useWorkspaceLocation } from "@/workspaces/location"
import { sameDirectory } from "@/workspaces/paths"

export function SessionLocationUnavailable(props: { sessionID: string }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const layout = useLayout()
  const tabs = useTabs()
  const pickDirectory = useDirectoryPicker()
  const location = useWorkspaceLocation()
  const [busy, setBusy] = createSignal(false)
  const project = createMemo(() => {
    const session = data.session.get(props.sessionID)
    const saved = session ? projectForSession(session, server.ctx.projects.list()) : undefined
    const unavailable = location().error
    // A missing worktree/subdirectory must not close its still-accessible parent project.
    return saved && unavailable && sameDirectory(saved.worktree, unavailable.directory) ? saved : undefined
  })

  const move = (directory: string) => {
    if (busy()) return
    setBusy(true)
    void server.ctx.sdk.api.session
      .move({ sessionID: props.sessionID, directory })
      .then(() => data.session.sync(props.sessionID))
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: language.t("workspace.move.failed"),
          description: formatServerError(error, language.t),
        }),
      )
      .finally(() => setBusy(false))
  }

  const close = () => {
    const saved = project()
    if (saved) {
      const next = closeHomeProject(layout.home.selection(), server.key, server.ctx.projects, saved.worktree)
      if (next) layout.home.setSelection(next)
    }
    tabs.removeSessionTab({ server: server.key, sessionId: props.sessionID })
  }

  return (
    <div data-component="session-location-unavailable" class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
        <Icon name="warning" size="large" class="text-icon-warning-base" />
        <div class="flex flex-col items-center gap-2">
          <div class="text-16-medium text-text max-w-md">
            {language.t(
              location().error?.type === "missing" ? "toast.project.missing.title" : "toast.project.permissionDenied.title",
            )}
          </div>
          <div class="text-13-regular text-text-weak max-w-md break-words">
            <Show when={location().error}>{(error) => formatProjectLocationError(error(), language.t)}</Show>
          </div>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          <Button
            variant="neutral"
            size="normal"
            disabled={busy()}
            onClick={() =>
              pickDirectory({
                server: server.conn,
                title: language.t("workspace.move.menu.title"),
                onSelect: (result) => {
                  if (typeof result === "string") move(result)
                },
              })
            }
          >
            {language.t("session.location.move")}
          </Button>
          <Button variant="neutral" size="normal" disabled={busy()} onClick={() => void location().retry()}>
            {language.t("session.location.retry")}
          </Button>
          <Button variant="neutral" size="normal" onClick={close}>
            {language.t(project() ? "session.location.closeProject" : "session.error.notFound.closeTab")}
          </Button>
        </div>
      </div>
    </div>
  )
}
