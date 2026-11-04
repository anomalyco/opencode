import { Show, type Component } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { fileManagerApp } from "@/home/projects/file-manager"
import { useRevealProject } from "@/home/projects/reveal"
import { pathKey } from "@/workspaces/path-key"

export const ProjectOptions: Component<{
  server: ServerConnection.Any
  project: LocalProject
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit?: () => void
  onRename?: () => void
  onAdd?: () => void
  class?: string
  size?: "small" | "normal" | "large"
}> = (props) => {
  const language = useLanguage()
  const global = useGlobal()
  const platform = usePlatform()
  const revealProject = useRevealProject()
  const context = () => global.ensureServerCtx(props.server)

  const directories = () => [props.project.worktree, ...(props.project.sandboxes ?? [])]

  const added = () =>
    context()
      .projects.used()
      .some((project) => pathKey(project.worktree) === pathKey(props.project.worktree))

  const hasUnread = () => directories().some((directory) => context().notification.project.hasUnread(directory))

  const clearNotifications = () => {
    const notification = context().notification
    directories().forEach((directory) => notification.project.markViewed(directory))
  }

  const addProject = () => {
    props.onAdd?.()
    context().projects.touch(props.project.worktree)
  }

  return (
    <Menu gutter={4} modal={false} placement="bottom-end" open={props.open} onOpenChange={props.onOpenChange}>
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
          <Show when={!added()}>
            <Menu.Item onSelect={addProject}>{language.t("home.project.add")}</Menu.Item>
          </Show>
          <Show when={props.onEdit} keyed>
            {(edit) => <Menu.Item onSelect={edit}>{language.t("common.edit")}</Menu.Item>}
          </Show>
          <Show when={props.onRename} keyed>
            {(rename) => <Menu.Item onSelect={rename}>{language.t("common.rename")}</Menu.Item>}
          </Show>
          <Show when={revealProject.available(props.server)}>
            <Menu.Item onSelect={() => revealProject.reveal(props.server, props.project)}>
              {language.t(fileManagerApp(platform.os ?? "unknown").actionLabel)}
            </Menu.Item>
          </Show>
          <Show when={added()}>
            <Menu.Item disabled={!hasUnread()} onSelect={clearNotifications}>
              {language.t("sidebar.project.clearNotifications")}
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
