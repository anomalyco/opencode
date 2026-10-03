import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { showToast } from "@opencode/ui/toast"
import { comparablePath, containsDirectory, getFilename, sameDirectory } from "@opencode/util/path"
import { createStore } from "solid-js/store"
import { For, onCleanup, Show, type ComponentProps, type JSX } from "solid-js"
import { useExtension, type Project, type MountedSession } from "../sdk"
import { workspaceDirectories } from "./paths"

export function SessionWorkspaceMenu(props: {
  session: MountedSession
  project: Project
  directory: string
  placement?: ComponentProps<typeof Menu>["placement"]
  class?: string
  children: JSX.Element
}) {
  const ctx = useExtension()
  const data = props.session.server.data

  const [store, setStore] = createStore<{ selected: string | undefined; directories: string[] }>({
    selected: undefined,
    directories: workspaceDirectories(props.project),
  })

  const blocked = () => data.session.status(props.session.id) === "running"
  const currentWorkspace = () => store.directories.find((workspace) => containsDirectory(workspace, props.directory))

  const workspaces = () =>
    store.directories.filter(
      (workspace) => comparablePath(workspace) !== comparablePath(currentWorkspace() ?? props.directory),
    )

  const update = (items: readonly { directory: string }[]) =>
    setStore(
      "directories",
      items.flatMap((item) => (sameDirectory(props.project.worktree, item.directory) ? [] : [item.directory])),
    )

  onCleanup(
    data.on("worktree.updated", (event) => {
      if (event.data.projectID !== props.project.id) return
      void props.session.server.client.worktree
        .list({ projectID: props.project.id })
        .then(update)
        .catch(() => undefined)
    }),
  )

  const onOpenChange = (open: boolean) => {
    if (!open) return
    const client = props.session.server.client
    void client.worktree
      .list({ projectID: props.project.id })
      .then(update)
      .then(() => client.worktree.refresh({ projectID: props.project.id }))
      .catch(() => undefined)
  }

  const createWorktree = async (client: MountedSession["server"]["client"], directory: string) => {
    const project =
      data.location.info({ directory })?.project ?? (await client.location.get({ location: { directory } })).project

    const created = await client.worktree.create({ projectID: project.id, from: project.canonical })
    // Populate the client cache before the destination session mounts.
    await data.location.syncInfo({ directory: created.directory })

    return created.directory
  }

  const move = async (selection: "create" | string) => {
    if (store.selected || blocked()) return
    const client = props.session.server.client
    const sessionID = props.session.id
    setStore("selected", selection)

    try {
      const destination = selection === "create" ? await createWorktree(client, props.directory) : selection

      if (!destination) return

      await client.session.move({ sessionID, directory: destination })
    } catch (error) {
      showToast({
        variant: "error",
        title: ctx.t("move.failed"),
        description: error instanceof Error ? error.message : ctx.t("common.requestFailed"),
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
            <Menu.GroupLabel>{ctx.t("move.menu")}</Menu.GroupLabel>
            <Show when={comparablePath(props.directory) !== comparablePath(props.project.worktree)}>
              <Menu.Item disabled={!!store.selected || blocked()} onSelect={() => void move(props.project.worktree)}>
                <Icon name="monitor" />
                {ctx.t("workspace.local")}
              </Menu.Item>
            </Show>
            <Menu.Item disabled={!!store.selected || blocked()} onSelect={() => void move("create")}>
              <Icon name="plus" />
              {ctx.t("workspace.new")}
            </Menu.Item>
            <Show when={workspaces().length > 0}>
              <Menu.Sub gutter={0} overlap overflowPadding={24}>
                <Menu.SubTrigger>
                  <Icon name="outline-worktree" />
                  {ctx.t("workspace.existing")}
                </Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent class="max-h-[66.667dvh] w-[200px] overflow-y-auto !pb-0 [&>[data-component=menu-v2-item]:last-child]:mb-0.5 [@media(max-height:600px)]:max-h-[calc(100dvh-48px)]">
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
