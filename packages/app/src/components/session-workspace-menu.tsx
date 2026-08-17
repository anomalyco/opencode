import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { createStore } from "solid-js/store"
import { createSignal, For, Show, type ComponentProps, type JSX } from "solid-js"
import type { Project } from "@/types"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettingsDialog } from "@/components/settings-dialog"
import { pathKey } from "@/utils/path-key"
import { showToast } from "@/utils/toast"
import { containsDirectory, sameDirectory, workspaceDirectories } from "@/utils/workspace"

export function SessionWorkspaceMenu(props: {
  eligible?: boolean
  sessionID: string
  project: Project
  directory: string
  placement?: ComponentProps<typeof MenuV2>["placement"]
  gutter?: number
  class?: string
  contentClass?: string
  children: JSX.Element
  onOpenChange?: (open: boolean) => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const openWorkspaces = useSettingsDialog("workspaces")
  const [store, setStore] = createStore({ selected: undefined as string | undefined })
  const [directories, setDirectories] = createSignal(workspaceDirectories(props.project))
  const blocked = () => props.eligible === false || serverSync.session.data.session_working(props.sessionID)
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
    <MenuV2
      placement={props.placement ?? "bottom-end"}
      gutter={props.gutter ?? 4}
      modal={false}
      onOpenChange={onOpenChange}
    >
      <MenuV2.Trigger class={props.class} disabled={blocked()}>
        {props.children}
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class={`w-[200px] ${props.contentClass ?? ""}`}>
          <MenuV2.Group>
            <MenuV2.GroupLabel>{language.t("workspace.move.menu.title")}</MenuV2.GroupLabel>
            <Show when={pathKey(props.directory) !== pathKey(props.project.worktree)}>
              <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move(props.project.worktree)}>
                <Icon name="monitor" />
                {language.t("session.new.workspace.local")}
              </MenuV2.Item>
            </Show>
            <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move("create")}>
              <Icon name="workspace-new" />
              {language.t("workspace.new")}
            </MenuV2.Item>
            <Show when={workspaces().length > 0}>
              <MenuV2.Sub gutter={0} overlap overflowPadding={8}>
                <MenuV2.SubTrigger>
                  <Icon name="workspace-isolated" />
                  {language.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")}
                </MenuV2.SubTrigger>
                <MenuV2.Portal>
                  <MenuV2.SubContent class="max-h-[calc(100dvh-16px)] w-[200px] overflow-y-auto">
                    <For each={workspaces()}>
                      {(workspace) => (
                        <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move(workspace)}>
                          <Icon name="workspace-isolated" />
                          <span class="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                        </MenuV2.Item>
                      )}
                    </For>
                  </MenuV2.SubContent>
                </MenuV2.Portal>
              </MenuV2.Sub>
            </Show>
          </MenuV2.Group>
          <MenuV2.Separator class="h-[0.5px] bg-v2-border-border-base" />
          <MenuV2.Item onSelect={() => openWorkspaces()}>
            <span class="min-w-0 flex-1 truncate">{language.t("common.viewAll")}</span>
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
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
