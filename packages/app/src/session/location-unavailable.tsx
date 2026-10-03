import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { formatProjectLocationError, formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { closeHomeProject } from "@/shell/layout/helpers"
import { useLayout } from "@/shell/state/layout"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useWorkspaceLocation } from "@/workspaces/location"
import { sameDirectory } from "@opencode/util/path"

// Recovery for a session or draft tab whose folder is missing. The caller supplies how the tab
// moves to another folder and how it closes.
export function LocationUnavailable(props: {
  moveLabel: string
  onMove: (directory: string) => Promise<unknown>
  onCloseTab: () => void
}) {
  const language = useLanguage()
  const server = useServer()
  const layout = useLayout()
  const pickDirectory = useDirectoryPicker()
  const location = useWorkspaceLocation()
  const [busy, setBusy] = createSignal(false)
  // A missing worktree/subdirectory must not close its still-accessible parent project.
  const project = createMemo(() => {
    const unavailable = location().error
    if (!unavailable) return
    return server.ctx.projects.list().find((item) => sameDirectory(item.worktree, unavailable.directory))
  })

  const move = (directory: string) => {
    if (busy()) return
    setBusy(true)
    void props
      .onMove(directory)
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
    props.onCloseTab()
  }

  return (
    <div data-component="session-location-unavailable" class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
        <Icon name="warning" size="large" class="text-icon-warning-base" />
        <div class="flex flex-col items-center gap-2">
          <div class="text-16-medium text-text max-w-md">
            {language.t("home.project.missing.title")}
          </div>
          <div class="text-13-regular text-text-weak max-w-md break-words">
            <Show when={location().error}>
              {(error) => formatProjectLocationError(error(), language.t)}
            </Show>
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
                title: props.moveLabel,
                onSelect: (result) => {
                  const directory = Array.isArray(result) ? result[0] : result
                  if (directory) move(directory)
                },
              })
            }
          >
            {props.moveLabel}
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
