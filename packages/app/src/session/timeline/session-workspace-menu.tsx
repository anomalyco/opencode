import { Menu } from "@opencode-ai/ui/menu"
import { Icon } from "@opencode-ai/ui/icon"
import { getFilename } from "@opencode-ai/util/path"
import { createStore } from "solid-js/store"
import { createSignal, For, Show, type ComponentProps, type JSX } from "solid-js"
import type { Project } from "@/runtime/server/types"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { pathKey } from "@/workspaces/path-key"
import { showToast } from "@/shell/notifications/toast"
import { containsDirectory, sameDirectory, workspaceDirectories } from "@/workspaces/paths"
import { createWorktree } from "@/workspaces/create"

export function SessionWorkspaceMenu(props: {
  eligible?: boolean
  sessionID: string
  project: Project
  directory: string
  placement?: ComponentProps<typeof Menu>["placement"]
  gutter?: number
  class?: string
  contentClass?: string
  children: JSX.Element
  onOpenChange?: (open: boolean) => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const data = useData()
  const [store, setStore] = createStore({ selected: undefined as string | undefined })
  const [directories, setDirectories] = createSignal(workspaceDirectories(props.project))
  const blocked = () => props.eligible === false || data.session.status(props.sessionID) === "running"
  const currentWorkspace = () => directories().find((workspace) => containsDirectory(workspace, props.directory))
  const workspaces = () =>
    directories().filter((workspace) => pathKey(workspace) !== pathKey(currentWorkspace() ?? props.directory))
  const onOpenChange = (open: boolean) => {
    props.onOpenChange?.(open)
    if (!open) return
    const sdk = serverSDK
    void sdk.api.worktree
      .refresh({ projectID: props.project.id })
      .then(() => sdk.api.worktree.list({ projectID: props.project.id }))
      .then((items) =>
        setDirectories(
          items.map((item) => item.directory).filter((directory) => !sameDirectory(props.project.worktree, directory)),
        ),
      )
      .catch(() => undefined)
  }
  const move = async (selection: "create" | string) => {
    if (store.selected || blocked()) return
    const sdk = serverSDK
    const sessionID = props.sessionID
    setStore("selected", selection)

    try {
      const destination =
        selection === "create"
          ? await createWorktree({
              api: sdk.api,
              data,
              directory: props.directory,
              project: data.location.info({ directory: props.directory })?.project,
            })
          : selection
      if (!destination) return

      await sdk.api.session.move({ sessionID, directory: destination })
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
      gutter={props.gutter ?? 4}
      modal={false}
      onOpenChange={onOpenChange}
    >
      <Menu.Trigger class={props.class} disabled={blocked()}>
        {props.children}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class={`w-[200px] ${props.contentClass ?? ""}`}>
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
              <Menu.Sub gutter={0} overlap overflowPadding={8}>
                <Menu.SubTrigger>
                  <Icon name="outline-worktree" />
                  {language.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")}
                </Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent class="max-h-[calc(100dvh-16px)] w-[200px] overflow-y-auto">
                    <For each={workspaces()}>
                      {(workspace) => (
                        <Menu.Item disabled={!!store.selected || blocked()} onSelect={() => void move(workspace)}>
                          <Icon name="outline-worktree" />
                          <span class="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
            </Show>
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
