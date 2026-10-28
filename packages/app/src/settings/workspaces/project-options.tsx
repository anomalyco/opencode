import { Show, type Component } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { fileManagerApp } from "@/home/projects/file-manager"
import { useRevealProject } from "@/home/projects/reveal"

export const ProjectOptions: Component<{
  server: ServerConnection.Any
  project: LocalProject
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit?: () => void
  onRename?: () => void
  onRemoved?: () => void
  class?: string
  size?: "small" | "normal" | "large"
}> = (props) => {
  const language = useLanguage()
  const global = useGlobal()
  const platform = usePlatform()
  const revealProject = useRevealProject()
  const dialog = useDialog()
  const context = () => global.ensureServerCtx(props.server)

  const directories = () => [props.project.worktree, ...(props.project.sandboxes ?? [])]

  const hasUnread = () => directories().some((directory) => context().notification.project.hasUnread(directory))

  const clearNotifications = () => {
    const notification = context().notification
    directories().forEach((directory) => notification.project.markViewed(directory))
  }

  const name = () => props.project.name ?? props.project.worktree
  const projectID = () => props.project.id

  const deleteHistory = async () => {
    const id = projectID()

    if (!id) return

    try {
      await context().sdk.api.session.removeProject({ projectID: id })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("toast.project.deleteHistory.failed.title"),
        description: errorMessage(cause, language.t("toast.project.deleteHistory.failed.title")),
      })
    }
  }

  const remove = async () => {
    const id = projectID()

    if (!id) return

    try {
      await context().sdk.api.project.remove({ projectID: id })
      props.onRemoved?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("toast.project.delete.failed.title"),
        description: errorMessage(cause, language.t("toast.project.delete.failed.title")),
      })
    }
  }

  const confirmDelete = (kind: "history" | "project") => {
    dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t(kind === "history" ? "dialog.project.deleteHistory.title" : "dialog.project.delete.title")}
            description={language.t(
              kind === "history" ? "dialog.project.deleteHistory.confirm" : "dialog.project.delete.confirm",
              { name: name() },
            )}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              dialog.close()
              void (kind === "history" ? deleteHistory() : remove())
            }}
          >
            {language.t("dialog.project.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }

  return (
    <Menu
      gutter={4}
      modal={false}
      placement="bottom-end"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Menu.Trigger
        as={IconButton}
        variant="ghost-muted"
        size={props.size ?? "small"}
        class={props.class}
        icon={<Icon name="outline-dots" />}
        aria-label={language.t("common.moreOptions")}
      />
      <Menu.Portal>
        <Menu.Content>
          <Show when={props.onEdit} keyed>
            {(edit) => <Menu.Item onSelect={edit}>{language.t("common.edit")}</Menu.Item>}
          </Show>
          <Show when={props.onRename} keyed>
            {(rename) => <Menu.Item onSelect={rename}>{language.t("common.rename")}</Menu.Item>}
          </Show>
          <Show when={revealProject.available(props.server)}>
            <Menu.Item onSelect={() => revealProject.reveal(props.server, props.project)}>{language.t(fileManagerApp(platform.os ?? "unknown").actionLabel)}</Menu.Item>
          </Show>
          <Menu.Item disabled={!hasUnread()} onSelect={clearNotifications}>
            {language.t("sidebar.project.clearNotifications")}
          </Menu.Item>
          <Show when={projectID()}>
            <Menu.Item onSelect={() => confirmDelete("history")}>{language.t("menu.project.deleteHistory")}</Menu.Item>
            <Menu.Item data-variant="critical" onSelect={() => confirmDelete("project")}>
              {language.t("menu.project.deleteProject")}
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
