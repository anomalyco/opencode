import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { DockShell, DockTray } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { getFilename, sameDirectory } from "@opencode/util/path"
import { useMutation } from "@tanstack/solid-query"
import { createEffect, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { createWorktree } from "@/workspaces/create"
import { useDirectoryPicker } from "@/workspaces/selection/picker"

export function SessionLocationMissing(props: { sessionID: string; projectID: string; directory: string }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const dialog = useDialog()
  const pickDirectory = useDirectoryPicker()
  const [state, setState] = createStore({ restoreFocus: false, worktreesOpen: false })
  const project = () => data.project.get(props.projectID)

  const [worktrees] = createResource(
    () => (state.worktreesOpen ? props.projectID : undefined),
    async (projectID) => {
      await server.ctx.sync.worktrees.refresh(projectID)
      const items = await server.ctx.sync.worktrees.list(projectID)

      if (!items) showToast({ variant: "error", title: language.t("session.location.worktreesFailed") })

      return items ?? []
    },
    // Seed latest so even the first fetch does not enter Suspense.
    { initialValue: [] },
  )
  const otherWorktrees = () =>
    worktrees.latest.filter((item) => item.strategy && !sameDirectory(item.directory, props.directory))

  let button: HTMLButtonElement | undefined

  const move = useMutation(() => ({
    mutationFn: async (input: { directory?: string }) => {
      // The missing worktree cannot resolve its own Location, so create from the project's saved checkout.
      const current = project()

      const destination =
        input.directory ??
        (current &&
          (await createWorktree({
            api: server.ctx.sdk.api,
            data,
            directory: current.canonical,
            project: { id: current.id, canonical: current.canonical, directory: current.canonical },
          })))

      if (!destination) return
      await server.ctx.sdk.api.session.move({ sessionID: props.sessionID, directory: destination })
    },
    onError: (error) => {
      setState("restoreFocus", true)
      showToast({
        variant: "error",
        title: language.t("session.location.moveFailed"),
        description: error instanceof Error ? error.message : language.t("common.requestFailed"),
      })
    },
  }))

  createEffect(() => {
    if (!state.restoreFocus || move.isPending || dialog.active) return
    setState("restoreFocus", false)
    button?.focus()
  })

  function choose() {
    if (move.isPending) return
    pickDirectory({
      server: server.conn,
      title: language.t("session.location.choose"),
      onSelect: (result) => {
        const selected = Array.isArray(result) ? result[0] : result

        if (selected) move.mutate({ directory: selected })

        if (!selected) setState("restoreFocus", true)
      },
    })
  }

  return (
    <div data-component="session-location-missing">
      <DockShell class="flex flex-col gap-2 p-3">
        <div role="status" class="flex items-start gap-2 text-13-regular leading-[var(--line-height-base)]">
          <Icon name="warning" class="shrink-0 text-icon-warning-base" />
          <div class="min-w-0 flex flex-col gap-1">
            <div class="font-medium text-text-strong">{language.t("session.location.unavailable")}</div>
            <div class="break-all font-mono text-12-regular text-text-weak">{props.directory}</div>
            <div class="text-text-base">{language.t("session.location.description")}</div>
          </div>
        </div>
      </DockShell>
      <DockTray attach="top" class="flex flex-wrap justify-end gap-2 p-2 pt-[22px]">
        <Show when={project()?.vcs === "git"}>
          <Menu placement="top-end" onOpenChange={(open) => setState("worktreesOpen", open)}>
            <Menu.Trigger as={Button} variant="neutral" disabled={move.isPending}>
              {language.t("session.location.worktree")}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content class="max-h-80 max-w-[calc(100vw-32px)] overflow-y-auto">
                <Menu.Item onSelect={() => move.mutate({})} disabled={move.isPending}>
                  <Icon name="workspace-new" />
                  {language.t("workspace.new")}
                </Menu.Item>
                <Show when={worktrees.loading && otherWorktrees().length === 0}>
                  <Menu.Item disabled>{language.t("common.loading")}</Menu.Item>
                </Show>
                <For each={otherWorktrees()}>
                  {(worktree) => (
                    <Menu.Item
                      title={worktree.directory}
                      onSelect={() => move.mutate({ directory: worktree.directory })}
                      disabled={move.isPending}
                    >
                      <Icon name="workspace-isolated" />
                      <span class="truncate">{getFilename(worktree.directory)}</span>
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </Show>
        <Button ref={button} variant="contrast" onClick={choose} disabled={move.isPending}>
          {language.t(move.isPending ? "session.location.moving" : "session.location.choose")}
        </Button>
      </DockTray>
    </div>
  )
}
