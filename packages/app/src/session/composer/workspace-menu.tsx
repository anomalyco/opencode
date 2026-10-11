import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { containsDirectory, sameDirectory } from "@opencode/util/path"
import { createStore } from "solid-js/store"
import { onCleanup, Show, type ComponentProps, type JSX } from "solid-js"
import type { Project } from "@/runtime/server/types"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { pathKey } from "@/workspaces/path-key"
import { showToast } from "@/shell/notifications/toast"
import { workspaceDirectories } from "@/workspaces/paths"
import { createWorktree } from "@/workspaces/create"
import { WorkspaceSubmenu } from "@/workspaces/submenu"

export function SessionWorkspaceMenu(props: {
  sessionID: string
  project: Project
  directory: string
  placement?: ComponentProps<typeof Menu>["placement"]
  class?: string
  children: JSX.Element
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const data = useData()

  const [store, setStore] = createStore<{ selected: string | undefined; directories: string[] }>({
    selected: undefined,
    directories: workspaceDirectories(props.project),
  })

  const blocked = () => data.session.status(props.sessionID) === "running"
  const currentWorkspace = () => store.directories.find((workspace) => containsDirectory(workspace, props.directory))

  const workspaces = () =>
    store.directories.filter((workspace) => pathKey(workspace) !== pathKey(currentWorkspace() ?? props.directory))

  const update = (items: readonly { directory: string }[]) =>
    setStore(
      "directories",
      items.flatMap((item) => (sameDirectory(props.project.worktree, item.directory) ? [] : [item.directory])),
    )

  onCleanup(
    serverSDK.event.listen((event) => {
      if (event.type !== "worktree.updated" || event.data.projectID !== props.project.id) return
      void serverSDK.api.worktree
        .list({ projectID: props.project.id })
        .then(update)
        .catch(() => undefined)
    }),
  )

  const onOpenChange = (open: boolean) => {
    if (!open) return
    void serverSDK.api.worktree
      .list({ projectID: props.project.id })
      .then(update)
      .then(() => serverSDK.api.worktree.refresh({ projectID: props.project.id }))
      .catch(() => undefined)
  }

  const move = async (selection: "create" | string) => {
    if (store.selected || blocked()) return
    setStore("selected", selection)

    try {
      const destination =
        selection === "create"
          ? await createWorktree({
              api: serverSDK.api,
              data,
              directory: props.directory,
              project: data.location.info({ directory: props.directory })?.project,
            })
          : selection

      await serverSDK.api.session.move({ sessionID: props.sessionID, directory: destination })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("workspace.move.failed"),
        description: error instanceof Error ? error.message : language.t("common.requestFailed"),
      })
    } finally {
      setStore("selected", undefined)
    }
  }

  return (
    <Menu
      placement={props.placement ?? "bottom-end"}
      gutter={4}
      overflowPadding={24}
      modal={false}
      onOpenChange={onOpenChange}
    >
      <Menu.Trigger class={props.class} disabled={blocked()}>
        {props.children}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class="w-[200px]">
          <Menu.Group>
            <Menu.GroupLabel>{language.t("workspace.move.menu.title")}</Menu.GroupLabel>
            <Show when={pathKey(props.directory) !== pathKey(props.project.worktree)}>
              <Menu.Item disabled={!!store.selected || blocked()} onSelect={() => void move(props.project.worktree)}>
                <Icon name="monitor" />
                {language.t("session.new.workspace.local")}
              </Menu.Item>
            </Show>
            <Menu.Item disabled={!!store.selected || blocked()} onSelect={() => void move("create")}>
              <Icon name="plus" />
              {language.t("workspace.new")}
            </Menu.Item>
            <Show when={workspaces().length > 0}>
              <WorkspaceSubmenu
                directories={workspaces()}
                disabled={!!store.selected || blocked()}
                onSelect={(directory) => void move(directory)}
              />
            </Show>
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
