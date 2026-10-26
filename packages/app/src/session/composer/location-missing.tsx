import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { DockShell, DockTray } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { ScrollView } from "@opencode/ui/scroll-view"
import { getFilename, sameDirectory } from "@opencode/util/path"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useMutation } from "@tanstack/solid-query"
import { createEffect, createResource, createUniqueId, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { createWorktree } from "@/workspaces/create"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import "./location-missing.css"

export function SessionLocationMissing(props: { sessionID: string; projectID: string; directory: string }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const dialog = useDialog()
  const pickDirectory = useDirectoryPicker()
  const [state, setState] = createStore({ restoreFocus: false, worktreesOpen: false, search: "" })
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

  const searchable = () => otherWorktrees().length >= 10

  const visibleWorktrees = () => {
    const query = state.search.trim().toLowerCase()

    const matches = query
      ? otherWorktrees().filter((item) => getFilename(item.directory).toLowerCase().includes(query))
      : otherWorktrees()

    return matches.slice(0, 10)
  }

  let button: HTMLButtonElement | undefined
  let searchInput: HTMLInputElement | undefined

  const move = useMutation(() => ({
    mutationFn: async (input: { source: "worktree" | "directory"; directory?: string }) => {
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

  const pending = (source: "worktree" | "directory") => move.isPending && move.variables?.source === source
  const id = createUniqueId()

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

        if (selected) move.mutate({ source: "directory", directory: selected })

        if (!selected) setState("restoreFocus", true)
      },
    })
  }

  return (
    <div data-component="session-location-missing">
      <DockShell data-slot="location-body">
        <div
          role="group"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-path ${id}-description`}
          data-slot="location-status"
        >
          <Icon name="warning" />
          <div data-slot="location-details">
            <div id={`${id}-title`} role="status" data-slot="location-title">
              {language.t("session.location.unavailable")}
            </div>
            <div id={`${id}-path`} data-slot="location-path">
              {props.directory}
            </div>
            <div id={`${id}-description`} data-slot="location-description">
              {language.t("session.location.description")}
            </div>
          </div>
        </div>
      </DockShell>
      <DockTray data-slot="location-footer">
        <Show when={project()?.vcs === "git"}>
          <Menu placement="top-end" onOpenChange={(open) => setState({ worktreesOpen: open, search: "" })}>
            <Menu.Trigger
              as={Button}
              variant={pending("worktree") ? "loading" : "neutral"}
              size="large"
              disabled={move.isPending}
            >
              <Show when={pending("worktree")}>
                <Loader />
              </Show>
              {language.t(pending("worktree") ? "session.location.moving" : "session.location.worktree")}
              <Show when={!pending("worktree")}>
                <Icon name="chevron-down" size="small" />
              </Show>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                ref={(element: HTMLElement) =>
                  // Hovering an item moves focus to it, so send typing back to the search field before type-ahead runs.
                  makeEventListener(
                    element,
                    "keydown",
                    (event) => {
                      if (!searchInput || event.target === searchInput) return

                      if (event.ctrlKey || event.metaKey || event.altKey) return

                      if (event.key.length !== 1 && event.key !== "Backspace") return

                      if (event.key === " " && !state.search) return

                      event.stopPropagation()
                      searchInput.focus({ preventScroll: true })
                    },
                    { capture: true },
                  )
                }
                class="max-h-[66.667dvh] w-[200px] overflow-hidden"
              >
                <Menu.Item onSelect={() => move.mutate({ source: "worktree" })} disabled={move.isPending}>
                  <Icon name="plus" />
                  <span class="min-w-0 flex-1 truncate">{language.t("workspace.new")}</span>
                </Menu.Item>
                <Show when={worktrees.loading || otherWorktrees().length > 0}>
                  <Menu.Separator class="h-[0.5px]" />
                </Show>
                <Show when={worktrees.loading && otherWorktrees().length === 0}>
                  <Menu.Item disabled>{language.t("common.loading")}</Menu.Item>
                </Show>
                <Show when={searchable()}>
                  <div class="flex h-7 items-center gap-2 rounded-sm ps-3 pe-2 text-v2-icon-icon-muted">
                    <Icon name="magnifying-glass" size="small" class="shrink-0" />
                    <input
                      // Worktrees load after the menu opens, so focus the field once it mounts.
                      ref={(element) => {
                        searchInput = element
                        requestAnimationFrame(() => requestAnimationFrame(() => element.focus({ preventScroll: true })))
                      }}
                      value={state.search}
                      placeholder={language.t("session.new.workspace.search.placeholder")}
                      aria-label={language.t("session.new.workspace.search.placeholder")}
                      class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                      onInput={(event) => setState("search", event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Escape" ||
                          event.key === "ArrowDown" ||
                          event.key === "ArrowUp" ||
                          event.key === "Enter"
                        )
                          return
                        event.stopPropagation()
                      }}
                    />
                  </div>
                </Show>
                <Show when={state.search.trim() && visibleWorktrees().length === 0}>
                  <div class="px-3 py-4 text-center text-[13px] font-[440] leading-5 text-v2-text-text-muted">
                    {language.t("session.new.workspace.search.empty")}
                  </div>
                </Show>
                <ScrollView focusable={false}>
                  <For each={visibleWorktrees()}>
                    {(worktree) => (
                      <Menu.Item
                        title={worktree.directory}
                        onSelect={() => move.mutate({ source: "worktree", directory: worktree.directory })}
                        disabled={move.isPending}
                      >
                        <Icon name="outline-worktree" />
                        <span class="min-w-0 flex-1 truncate">{getFilename(worktree.directory)}</span>
                      </Menu.Item>
                    )}
                  </For>
                </ScrollView>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </Show>
        <Button
          ref={button}
          variant={pending("directory") ? "loading" : "submit"}
          size="large"
          onClick={choose}
          disabled={move.isPending}
        >
          <Show when={pending("directory")}>
            <Loader />
          </Show>
          {language.t(pending("directory") ? "session.location.moving" : "session.location.choose")}
        </Button>
      </DockTray>
    </div>
  )
}
