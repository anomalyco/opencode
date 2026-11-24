import { Popover } from "@kobalte/core/popover"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createOverlayFocus } from "@opencode/ui/context/overlay-focus"
import { DockShell, DockTray } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { createTypeahead } from "@opencode/ui/typeahead"
import { getFilename } from "@opencode/util/path"
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
import "@/shell/palette-menu.css"
import "./location-missing.css"

export function SessionLocationMissing(props: { sessionID: string; projectID: string; directory: string }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const dialog = useDialog()
  const pickDirectory = useDirectoryPicker()
  const project = () => data.project.get(props.projectID)

  const [machine, setMachine] = createSignal(
    createLocationMissingState(untrack(() => server.ctx.sync.worktrees.cached(props.projectID) ?? [])),
  )

  const view = createMemo(() => selectLocationMissingView(machine(), props.directory))
  const overlayFocus = createOverlayFocus()
  let timer: ReturnType<typeof setTimeout> | undefined
  let button: HTMLButtonElement | undefined
  let trigger: HTMLButtonElement | undefined
  let searchInput: HTMLInputElement | undefined
  let listbox: HTMLDivElement | undefined

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
        (error) => dispatch({ type: "move.failed", attempt: effect.attempt, error, dialogOpen: !!dialog.active }),
      )

      return
    }

    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer =
        effect.phase === "menu-loading"
          ? setTimeout(
              () => dispatch({ type: "worktrees.timed-out", attempt: effect.attempt }),
              WORKTREES_LOAD_TIMEOUT_MS,
            )
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

  createEffect(
    on(
      () => !!dialog.active,
      (open) => dispatch({ type: "dialog.changed", open }),
      { defer: true },
    ),
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  const id = createUniqueId()

  // "New worktree" is the empty directory; each worktree row moves the session to its directory.
  const entries = createMemo(() => ["", ...view().visibleWorktrees.map((worktree) => worktree.directory)])

  const choose = (directory: string) => dispatch({ type: "move.worktree", directory: directory || undefined })

  // Focus stays in the search field, or on the list without one, while arrow keys and the pointer move the highlight.
  const typeahead = createTypeahead({ items: entries, key: (directory) => directory, onSelect: choose })

  const revealActive = () => {
    const active = typeahead.activeID()

    if (active) document.getElementById(active)?.scrollIntoView({ block: "nearest" })
  }

  const search = (value: string) => {
    dispatch({ type: "search.changed", search: value })
    // A query highlights its first match rather than "New worktree", so Enter after typing picks a match.
    typeahead.setActive(view().visibleWorktrees[0]?.directory)
  }

  const row = (directory: string) => (
    <div
      id={typeahead.optionID(directory)}
      role="option"
      class="palette-menu-row"
      data-size="compact"
      title={directory || undefined}
      aria-selected={typeahead.activeItem() === directory}
      aria-disabled={view().disabled}
      data-active={typeahead.activeItem() === directory ? "" : undefined}
      onMouseMove={(event) => {
        // A static cursor must not steal the highlight while the keyboard scrolls the list.
        if (event.movementX !== 0 || event.movementY !== 0) typeahead.setActive(directory)
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(directory)}
    >
      <Icon name={directory ? "outline-worktree" : "plus"} class="shrink-0" />
      <span class="min-w-0 flex-1 truncate">{directory ? getFilename(directory) : language.t("workspace.new")}</span>
    </div>
  )

  const onListKeyDown = (event: KeyboardEvent) => {
    const items = entries()

    // The list is one stop: Tab closes it and moves on from the trigger, as the browser would from there.
    if (event.key === "Tab") {
      trigger?.focus({ preventScroll: true })

      return dispatch({ type: "menu.toggled", open: false })
    }

    if (!searchInput?.isConnected && (event.key === "Home" || event.key === "End" || event.key === " ")) {
      event.preventDefault()

      if (event.key === " ") return choose(typeahead.activeItem() ?? "")
      typeahead.setActive(items[event.key === "Home" ? 0 : items.length - 1])

      return revealActive()
    }

    typeahead.onKeyDown(event)

    if (event.key === "ArrowDown" || event.key === "ArrowUp") revealActive()
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
          <Popover
            placement="top-end"
            gutter={4}
            open={view().menuOpen}
            onOpenChange={(open) => {
              overlayFocus.openChanged(open)
              typeahead.setActive(undefined)
              dispatch({ type: "menu.toggled", open })
            }}
          >
            <Popover.Trigger
              ref={trigger}
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
                <Icon name="chevron-down" />
              </Show>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                aria-label={language.t("session.location.worktree")}
                class="z-50 flex max-h-[min(66.667dvh,var(--kb-popper-content-available-height))] w-[200px] flex-col overflow-hidden rounded-md bg-v2-background-bg-layer-01 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-base shadow-[var(--v2-elevation-floating)] outline-none"
                onOpenAutoFocus={(event) => {
                  event.preventDefault()
                  ;(searchInput?.isConnected ? searchInput : listbox)?.focus({ preventScroll: true })
                }}
                onCloseAutoFocus={(event) => overlayFocus.restore(event, trigger)}
              >
                <Show when={view().searchable}>
                  <div class="flex h-8 shrink-0 items-center gap-2 ps-3 pe-2 text-v2-icon-icon-muted">
                    <Icon name="magnifying-glass" class="shrink-0" />
                    <input
                      // Worktrees can load after the list opens, so the field takes focus from the list when it mounts.
                      ref={(element) => {
                        searchInput = element
                        requestAnimationFrame(() => {
                          if (document.activeElement === listbox) element.focus({ preventScroll: true })
                        })
                      }}
                      value={view().search}
                      placeholder={language.t("session.new.workspace.search.placeholder")}
                      aria-label={language.t("session.new.workspace.search.placeholder")}
                      autocomplete="off"
                      spellcheck={false}
                      role="combobox"
                      aria-expanded="true"
                      aria-autocomplete="list"
                      aria-controls={typeahead.listID}
                      aria-activedescendant={typeahead.activeID()}
                      class="h-8 min-w-0 flex-1 border-0 bg-transparent text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                      onInput={(event) => search(event.currentTarget.value)}
                      onKeyDown={onListKeyDown}
                    />
                  </div>
                  <div aria-hidden="true" class="h-[0.5px] shrink-0 bg-v2-border-border-base" />
                </Show>
                <MenuScroll class="min-h-0 flex-1" viewportClass="p-0.5">
                  <div
                    ref={listbox}
                    id={typeahead.listID}
                    role="listbox"
                    aria-label={language.t("session.location.worktree")}
                    // With a search field, the field holds focus and names the active option instead.
                    tabIndex={view().searchable ? -1 : 0}
                    aria-activedescendant={view().searchable ? undefined : typeahead.activeID()}
                    class="outline-none"
                    onKeyDown={onListKeyDown}
                  >
                    {row("")}
                    <Show when={view().hasMenuSeparator}>
                      <div aria-hidden="true" class="mx-1 my-0.5 h-[0.5px] bg-v2-border-border-base" />
                    </Show>
                    <For each={view().visibleWorktrees}>{(worktree) => row(worktree.directory)}</For>
                  </div>
                  <Show when={view().menuLoading}>
                    <div class="flex h-7 items-center px-2 text-v2-text-text-faint">{language.t("common.loading")}</div>
                  </Show>
                  <Show when={view().emptySearch}>
                    <div class="px-3 py-4 text-center text-v2-text-text-muted">
                      {language.t("session.new.workspace.search.empty")}
                    </div>
                  </Show>
                </MenuScroll>
              </Popover.Content>
            </Popover.Portal>
          </Popover>
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
