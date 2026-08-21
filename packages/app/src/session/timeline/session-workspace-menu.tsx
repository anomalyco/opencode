import { Menu } from "@opencode-ai/ui/menu"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createStore } from "solid-js/store"
import { createSignal, For, Show, type ComponentProps, type JSX } from "solid-js"
import type { Project } from "@/types"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useData } from "@/context/server"
import { useSettingsDialog } from "@/components/settings-dialog"
import { pathKey } from "@/utils/path-key"
import { showToast } from "@/utils/toast"
import { containsDirectory, sameDirectory, workspaceDirectories } from "@/utils/workspace"

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
  const openWorkspaces = useSettingsDialog("workspaces")
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
      const destination = selection === "create" ? await createWorkspace(props.project, sdk) : selection
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
              <Icon name="workspace-new" />
              {language.t("workspace.new")}
            </Menu.Item>
            <Show when={workspaces().length > 0}>
              <Menu.Sub gutter={0} overlap overflowPadding={8}>
                <Menu.SubTrigger>
                  <Icon name="workspace-isolated" />
                  {language.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")}
                </Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent class="max-h-[calc(100dvh-16px)] w-[200px] overflow-y-auto">
                    <For each={workspaces()}>
                      {(workspace) => (
                        <Menu.Item disabled={!!store.selected || blocked()} onSelect={() => void move(workspace)}>
                          <Icon name="workspace-isolated" />
                          <span class="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
            </Show>
          </Menu.Group>
          <Menu.Separator class="h-[0.5px] bg-v2-border-border-base" />
          <Menu.Item onSelect={() => openWorkspaces()}>
            <span class="min-w-0 flex-1 truncate">{language.t("common.viewAll")}</span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

async function createWorkspace(project: Project, serverSDK: ReturnType<typeof useServerSDK>) {
  const created = await serverSDK.api.worktree.create({
    projectID: project.id,
    strategy: "git",
    directory: getDirectory(project.worktree),
  })
  await serverSDK.api.location.get({ location: { directory: created.directory } })
  return created.directory
}
