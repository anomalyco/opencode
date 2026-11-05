import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { DockShell, DockTray } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { getFilename } from "@opencode/util/path"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, Show, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { createWorktree } from "@/workspaces/create"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import {
  createLocationMissingState,
  LOCATION_MOVE_SETTLE_TIMEOUT_MS,
  selectLocationMissingView,
  transitionLocationMissing,
  WORKTREES_LOAD_TIMEOUT_MS,
  type LocationMissingEffect,
  type LocationMissingEvent,
} from "./location-missing-machine"
import "./location-missing.css"

export function SessionLocationMissing(props: { sessionID: string; projectID: string; directory: string }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const dialog = useDialog()
  const pickDirectory = useDirectoryPicker()
  const project = () => data.project.get(props.projectID)

  const [machine, setMachine] = createSignal(
    createLocationMissingState(
      untrack(() => server.ctx.sync.worktrees.cached(props.projectID) ?? project()?.worktrees ?? []),
    ),
  )

  const view = createMemo(() => selectLocationMissingView(machine(), props.directory))
  let timer: ReturnType<typeof setTimeout> | undefined
  let button: HTMLButtonElement | undefined
  let searchInput: HTMLInputElement | undefined

  const dispatch = (event: LocationMissingEvent) => {
    const next = transitionLocationMissing(untrack(machine), event)

    if (next.state !== untrack(machine)) setMachine(next.state)
    next.effects.forEach(run)
  }

  function run(effect: LocationMissingEffect) {
    if (effect.type === "worktrees.load") {
      const projectID = props.projectID

      void server.ctx.sync.worktrees
        .refresh(projectID)
        .then(() => server.ctx.sync.worktrees.list(projectID))
        .then((items) => dispatch({ type: "worktrees.loaded", attempt: effect.attempt, items }))

      return
    }

    if (effect.type === "picker.open")
      return pickDirectory({
        server: server.conn,
        title: language.t("session.location.choose"),
        onSelect: (result) =>
          dispatch({
            type: "picker.settled",
            attempt: effect.attempt,
            directory: (Array.isArray(result) ? result[0] : result) ?? undefined,
            dialogOpen: !!dialog.active,
          }),
      })

    if (effect.type === "move.run") {
      // Creating the worktree is not aborted on unmount: cutting it off kills the project's setup script midway.
      void moveSession(effect.directory).then(
        () => dispatch({ type: "move.succeeded", attempt: effect.attempt }),
        (error: unknown) => dispatch({ type: "move.failed", attempt: effect.attempt, error, dialogOpen: !!dialog.active }),
      )

      return
    }

    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer =
        effect.phase === "menu-loading"
          ? setTimeout(() => dispatch({ type: "worktrees.timed-out", attempt: effect.attempt }), WORKTREES_LOAD_TIMEOUT_MS)
          : setTimeout(
              () => dispatch({ type: "move.settle-timed-out", attempt: effect.attempt }),
              LOCATION_MOVE_SETTLE_TIMEOUT_MS,
            )

      return
    }

    if (effect.type === "timer.cancel") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "focus.choose") return button?.focus()

    if (effect.type === "toast.worktrees-failed")
      return void showToast({ variant: "error", title: language.t("session.location.worktreesFailed") })

    showToast({
      variant: "error",
      title: language.t("session.location.moveFailed"),
      description: effect.error instanceof Error ? effect.error.message : language.t("common.requestFailed"),
    })
  }

  const moveSession = async (directory: string | undefined) => {
    // The missing worktree cannot resolve its own Location, so create from the project's saved checkout.
    const current = project()

    const destination =
      directory ??
      (current &&
        (await createWorktree({
          api: server.ctx.sdk.api,
          data,
          directory: current.canonical,
          project: { id: current.id, canonical: current.canonical, directory: current.canonical },
        })))

    // The project has not loaded yet, so there is no checkout to create the worktree from.
    if (!destination) throw new Error(language.t("common.requestFailed"))
    await server.ctx.sdk.api.session.move({ sessionID: props.sessionID, directory: destination })
    // Read the moved session now, so the notice gives way even when the server's event lags.
    await data.session.sync(props.sessionID).catch(() => undefined)
  }

  createEffect(on(() => !!dialog.active, (open) => dispatch({ type: "dialog.changed", open }), { defer: true }))
  onCleanup(() => dispatch({ type: "disposed" }))

  const id = createUniqueId()

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
          <Menu
            placement="top-end"
            open={view().menuOpen}
            onOpenChange={(open) => dispatch({ type: "menu.toggled", open })}
          >
            <Menu.Trigger
              as={Button}
              variant={view().pendingWorktree ? "loading" : "neutral"}
              size="large"
              disabled={view().disabled}
            >
              <Show when={view().pendingWorktree}>
                <Loader />
              </Show>
              {language.t(view().pendingWorktree ? "session.location.moving" : "session.location.worktree")}
              <Show when={!view().pendingWorktree}>
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

                      if (event.key === " " && !view().search) return
                      event.stopPropagation()
                      searchInput.focus({ preventScroll: true })
                    },
                    { capture: true },
                  )
                }
                class="max-h-[66.667dvh] w-[200px] !p-0"
              >
                <MenuScroll viewportClass="p-0.5">
                  <Menu.Item onSelect={() => dispatch({ type: "move.worktree" })} disabled={view().disabled}>
                    <Icon name="plus" />
                    <span class="min-w-0 flex-1 truncate">{language.t("workspace.new")}</span>
                  </Menu.Item>
                  <Show when={view().hasMenuSeparator}>
                    <Menu.Separator class="h-[0.5px]" />
                  </Show>
                  <Show when={view().menuLoading}>
                    <Menu.Item disabled>{language.t("common.loading")}</Menu.Item>
                  </Show>
                  <Show when={view().searchable}>
                    <div class="flex h-7 items-center gap-2 rounded-sm ps-3 pe-2 text-v2-icon-icon-muted">
                      <Icon name="magnifying-glass" size="small" class="shrink-0" />
                      <input
                        // Worktrees load after the menu opens, so focus the field once it mounts.
                        ref={(element) => {
                          searchInput = element
                          requestAnimationFrame(() =>
                            requestAnimationFrame(() => element.focus({ preventScroll: true })),
                          )
                        }}
                        value={view().search}
                        placeholder={language.t("session.new.workspace.search.placeholder")}
                        aria-label={language.t("session.new.workspace.search.placeholder")}
                        class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                        onInput={(event) => dispatch({ type: "search.changed", search: event.currentTarget.value })}
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
                  <Show when={view().emptySearch}>
                    <div class="px-3 py-4 text-center text-[13px] font-[440] leading-5 text-v2-text-text-muted">
                      {language.t("session.new.workspace.search.empty")}
                    </div>
                  </Show>
                  <For each={view().visibleWorktrees}>
                    {(worktree) => (
                      <Menu.Item
                        title={worktree.directory}
                        onSelect={() => dispatch({ type: "move.worktree", directory: worktree.directory })}
                        disabled={view().disabled}
                      >
                        <Icon name="outline-worktree" />
                        <span class="min-w-0 flex-1 truncate">{getFilename(worktree.directory)}</span>
                      </Menu.Item>
                    )}
                  </For>
                </MenuScroll>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </Show>
        <Button
          ref={button}
          variant={view().pendingDirectory ? "loading" : "submit"}
          size="large"
          onClick={() => dispatch({ type: "choose.requested" })}
          disabled={view().disabled}
        >
          <Show when={view().pendingDirectory}>
            <Loader />
          </Show>
          {language.t(view().pendingDirectory ? "session.location.moving" : "session.location.choose")}
        </Button>
      </DockTray>
    </div>
  )
}
