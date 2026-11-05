import type { SessionInfo } from "@opencode/client/promise"
import { Key } from "@solid-primitives/keyed"
import { createEffect, createMemo, createSignal, For, Index, Match, onCleanup, Show, Switch, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { InlineInput } from "@opencode/ui/inline-input"
import { Loader } from "@opencode/ui/loader"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { showToast } from "@/shell/notifications/toast"
import { sessionLabel } from "@/session/title"
import { shouldOpenSessionInBackground } from "./open"
import { createAltHold } from "./alt-hold"
import "./view.css"
import {
  HomeSessionStatusController,
  homeSessionSearchKey,
  type HomeSessionGroup,
  type HomeSessionRecord,
  type OpenSessionOptions,
} from "./controller"
import type { HomeSessionsFailure, HomeSessionsListView, HomeSessionsUnavailableReason } from "./load-machine"
import {
  INITIAL_HOME_SESSION_ROW_STATE,
  selectLongPressMoved,
  selectRowEditor,
  selectRowMenu,
  selectRowSuppressClick,
  transitionHomeSessionRow,
  type HomeSessionRowEffect,
  type HomeSessionRowEvent,
  type HomeSessionRowState,
} from "./row-machine"

const SHOW_HOME_SESSION_ARCHIVE = false

const HOME_SECTION_LABEL = "text-v2-text-text-muted [font-weight:440]"

const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"

const POINTER_DOWN: HomeSessionRowEvent = Object.freeze({ type: "pointer.down" })

const TOUCH_UP: HomeSessionRowEvent = Object.freeze({ type: "touch.up" })

const TOUCH_CANCEL: HomeSessionRowEvent = Object.freeze({ type: "touch.cancel" })

// Title widths for the placeholder rows, as a share of the row's label area.
const HOME_SESSION_PLACEHOLDER_WIDTHS = [56, 38, 66, 46, 30, 52]

// Middle-click or Cmd+click on macOS (Ctrl+click elsewhere) opens a session
// tab in the background without navigating, matching browser conventions.
function isBackgroundOpen(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

export type HomeSessionsViewProps = {
  language: ReturnType<typeof useLanguage>
  groups: HomeSessionGroup[]
  listView: HomeSessionsListView
  desktop: boolean
  location: (record: HomeSessionRecord) => { worktree: string; branch: string | undefined }
  onRevealLocations: (record?: HomeSessionRecord) => void
  showProjectName: boolean
  server: ServerConnection.Key
  canCreateSession: boolean
  searchValue: string
  searchPlaceholder: string
  searchOpen: boolean
  searchLoading: boolean
  searchResults: HomeSessionRecord[]
  searchActive: string
  searchNoResultsLabel: string
  titleOpacity: (id: HomeSessionGroup["id"]) => number
  isOpenTab: (record: HomeSessionRecord) => boolean
  onCreateSession: () => void
  onRetry: () => void
  onOpenSession: (session: SessionInfo, options?: OpenSessionOptions) => void
  onArchiveSession: (session: SessionInfo) => Promise<void>
  onRenameSession: (
    server: ServerConnection.Key,
    session: SessionInfo,
    title: string,
    signal: AbortSignal,
  ) => Promise<boolean>
  onExportSession: (server: ServerConnection.Key, session: SessionInfo) => Promise<void>
  onDeleteSession: (server: ServerConnection.Key, session: SessionInfo) => void
  onSetHoverTarget: (element: HTMLElement) => void
  onSetThumbTrack: (element: HTMLDivElement) => void
  onSetContent: (element: HTMLDivElement) => void
  onSetHeader: (id: HomeSessionGroup["id"], element: HTMLDivElement) => void
  onWheel: (event: WheelEvent) => void
  onSetSearchRoot: (element: HTMLDivElement) => void
  onSetSearchInput: (element: HTMLInputElement) => void
  onSetSearchList: (element: HTMLDivElement) => void
  onSearchFocus: () => void
  onSearchBlur: (next: EventTarget | null) => void
  onSearchInput: (value: string) => void
  onSearchClose: () => void
  onSearchMove: (delta: number) => void
  onSearchSelectActive: () => void
  onSearchHighlight: (record: HomeSessionRecord) => void
  onSearchSelect: (record: HomeSessionRecord, options?: OpenSessionOptions) => void
}

export function HomeSessionsView(props: HomeSessionsViewProps) {
  // Session store updates and date-group moves recreate row components, so the menu, long press and rename live here,
  // keyed by session ID.
  const [rowState, setRowState] = createSignal(INITIAL_HOME_SESSION_ROW_STATE)
  const [hover, setHover] = createStore<{ sessionID: string | undefined }>({ sessionID: undefined })
  const showLocations = createAltHold(props.desktop, props.onRevealLocations)
  let longPressTimer: ReturnType<typeof setTimeout> | undefined
  const renames = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  // A list that arrives within the delay paints directly; slower loads show placeholder rows until it does, which stay
  // mounted while the list fades in over them.
  const skeleton = () =>
    (props.listView.status === "loading" && props.listView.skeleton) ||
    (props.listView.status === "ready" && props.listView.revealing)

  const dispatchRow = (event: HomeSessionRowEvent) =>
    untrack(() => {
      const previous = rowState()
      const next = transitionHomeSessionRow(previous, event)

      if (next.state !== previous) setRowState(next.state)
      next.effects.forEach(runRowEffect)
    })

  function runRowEffect(effect: HomeSessionRowEffect) {
    if (effect.type === "long-press.start") {
      clearTimeout(longPressTimer)
      longPressTimer = setTimeout(
        () => dispatchRow({ type: "long-press.fired", attempt: effect.attempt }),
        effect.delayMs,
      )

      return
    }

    if (effect.type === "long-press.stop") return clearTimeout(longPressTimer)

    if (effect.type === "rename.save") {
      const attempt = effect.attempt
      const controller = new AbortController()
      const timer = setTimeout(() => dispatchRow({ type: "rename.timed-out", attempt }), effect.timeoutMs)
      renames.set(attempt, { controller, timer })
      // A cancelled save resolves false for an attempt the machine already left.
      void props.onRenameSession(effect.server, effect.session, effect.title, controller.signal).then((saved) => {
        clearTimeout(timer)
        renames.delete(attempt)
        dispatchRow({ type: saved ? "rename.succeeded" : "rename.failed", attempt })
      })

      return
    }

    if (effect.type === "rename.abort") {
      const rename = renames.get(effect.attempt)
      clearTimeout(rename?.timer)
      rename?.controller.abort()
      renames.delete(effect.attempt)

      return
    }

    if (effect.type === "toast.rename-timeout") {
      showToast({
        title: props.language.t("common.requestFailed"),
        description: props.language.t("home.sessions.load.timeout"),
      })

      return
    }

    // Focus targets are looked up by session ID: rows remount, so instance refs can point at detached nodes.
    const row = `[data-component="home-session-row-container"][data-session-id="${effect.sessionID}"]`
    const active = document.activeElement

    if (effect.ifOwned && active !== document.body && !document.querySelector(row)?.contains(active)) return
    requestAnimationFrame(() => {
      if (effect.type === "focus.row") {
        document.querySelector<HTMLButtonElement>(`${row} [data-component="home-session-row"]`)?.focus()

        return
      }

      const input = document.querySelector<HTMLInputElement>(`${row} [data-component="home-session-rename"]`)
      input?.focus()

      if (effect.select) input?.select()
    })
  }

  createEffect(() => {
    const sessionIDs = new Set(props.groups.flatMap((group) => group.sessions.map((record) => record.session.id)))
    dispatchRow({ type: "sessions.synced", sessionIDs })
  })
  onCleanup(() => dispatchRow({ type: "disposed" }))

  return (
    <section
      ref={props.onSetHoverTarget}
      class="min-h-0 min-w-0 flex-1 flex flex-col"
      aria-label={props.language.t("sidebar.project.recentSessions")}
    >
      <div
        class="sticky top-0 z-30 shrink-0 bg-v2-background-bg-base pb-1 pt-6 md:pb-3 lg:pt-12"
        onWheel={props.onWheel}
      >
        <HomeSessionSearch
          {...props}
          showLocations={showLocations()}
          hoveredSession={hover.sessionID}
          onHoverSession={(sessionID) => setHover("sessionID", sessionID)}
        />
        <Show when={props.groups.length > 0 && props.canCreateSession}>
          <div class="pointer-events-none absolute right-0 top-[68px] z-20 flex md:top-[84px] lg:top-[108px]">
            <Button
              data-action="home-new-session"
              variant="ghost-muted"
              size="normal"
              icon="edit"
              class="pointer-events-auto h-7 px-2 [font-weight:530]"
              onClick={props.onCreateSession}
            >
              {props.language.t("command.session.new")}
            </Button>
          </div>
        </Show>
      </div>
      <div class="pointer-events-none sticky top-[68px] z-40 h-0 -mr-3 md:top-[84px] lg:top-[108px]">
        <div
          ref={props.onSetThumbTrack}
          data-component="home-session-scroll-track"
          class="relative ml-auto h-[calc(100cqh-68px)] w-3 md:h-[calc(100cqh-84px)] lg:h-[calc(100cqh-108px)]"
        />
      </div>
      <div
        data-slot="home-sessions-list"
        data-reveal={skeleton() || undefined}
        class="relative -mr-3 min-h-[calc(100cqh-64px)] md:min-h-[calc(100cqh-72px)] lg:min-h-[calc(100cqh-96px)]"
        aria-busy={props.listView.status === "loading"}
      >
        <Show when={skeleton()}>
          <HomeSessionSkeleton
            visible={props.listView.status === "loading"}
            showProjectName={props.showProjectName}
            desktop={props.desktop}
          />
        </Show>
        <Switch>
          <Match when={props.listView.status === "error" && props.listView.failure} keyed>
            {(failure) => (
              <HomeSessionsUnavailable
                role="alert"
                title={props.language.t("home.sessions.load.failed")}
                description={failureDescription(failure, props.language)}
                onRetry={props.onRetry}
                language={props.language}
              />
            )}
          </Match>
          <Match when={props.listView.status === "unavailable" && props.listView.reason} keyed>
            {(reason) => (
              <HomeSessionsUnavailable
                role="status"
                title={props.language.t(UNAVAILABLE_TITLE[reason])}
                onRetry={reason === "offline" ? props.onRetry : undefined}
                language={props.language}
              />
            )}
          </Match>
          <Match when={props.listView.status === "ready" && props.groups.length === 0}>
            <HomeSessionsEmpty
              onNewSession={props.canCreateSession ? props.onCreateSession : undefined}
              language={props.language}
            />
          </Match>
          <Match when={props.listView.status === "ready"}>
            <div ref={props.onSetContent} class="flex flex-col pt-1 pr-3 pb-16 md:pt-3">
              {/* Index keeps group subtrees mounted when the group arrays are
                  rebuilt, so store updates cannot recreate rows mid-gesture. */}
              <Index each={props.groups}>
                {(group, index) => (
                  <>
                    <HomeSessionGroupHeader
                      title={group().title}
                      titleOpacity={props.titleOpacity(group().id)}
                      onSetRef={(element) => props.onSetHeader(group().id, element)}
                      elevated={index === 0}
                    />
                    <div
                      class={`flex min-w-0 flex-col gap-px pt-2 md:pt-4 ${index === props.groups.length - 1 ? "" : "mb-6"}`}
                    >
                      {/* Rows key by session ID: session.sync replaces the
                          stored session object wholesale, so reference-keyed
                          rows would be disposed mid-interaction whenever a
                          sync response lands. */}
                      <Key each={group().sessions} by={(record) => record.session.id}>
                        {(record) => (
                          <HomeSessionRow
                            {...props}
                            record={record()}
                            rowState={rowState()}
                            onRowEvent={dispatchRow}
                            showLocations={showLocations()}
                            hoveredSession={hover.sessionID}
                            onHoverSession={(sessionID) => setHover("sessionID", sessionID)}
                          />
                        )}
                      </Key>
                    </div>
                  </>
                )}
              </Index>
            </div>
          </Match>
        </Switch>
      </div>
    </section>
  )
}

const UNAVAILABLE_TITLE = {
  offline: "session.error.unreachable",
  auth: "session.error.signedOut",
  incompatible: "session.error.incompatible",
} as const satisfies Record<HomeSessionsUnavailableReason, string>

function failureDescription(failure: HomeSessionsFailure, language: ReturnType<typeof useLanguage>) {
  return failure.type === "timeout" ? language.t("home.sessions.load.timeout") : failure.message
}

// The project avatar leads the row and never changes; a working session shows its activity ring at the row's trailing
// edge, as session tabs do. `order-last` moves the ring past the labels from here, so one status subscription serves
// both, and `ms-auto` pins it to the end even where the labels are `display: contents`.
function HomeSessionIndicators(props: {
  server: HomeSessionsViewProps["server"]
  isOpenTab: HomeSessionsViewProps["isOpenTab"]
  record: HomeSessionRecord
}) {
  return (
    <HomeSessionStatusController
      server={props.server}
      record={props.record}
      isOpenTab={props.isOpenTab}
      render={(state) => (
        <>
          {/* A busy session shows its activity ring instead of the unread dot. */}
          <HomeSessionLeading record={props.record} open={state.open()} unread={state.unread() && !state.loading()} />
          <Show when={state.loading()}>
            <ActivityRing class="order-last ms-auto" />
          </Show>
        </>
      )}
    />
  )
}

function HomeSessionLeading(props: { record: HomeSessionRecord; open: boolean; unread: boolean }) {
  return (
    <div class="relative shrink-0">
      <Show when={props.open}>
        <span
          aria-hidden="true"
          class={`
            pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2
            rounded-[2px] bg-v2-background-bg-layer-04
          `}
          style={{ right: "calc(100% + 4px)" }}
        />
      </Show>
      <SessionTabAvatarView
        project={props.record.project}
        directory={props.record.session.location.directory}
        unread={props.unread}
      />
    </div>
  )
}

function HomeSessionSearch(
  props: HomeSessionsViewProps & {
    showLocations: boolean
    hoveredSession: string | undefined
    onHoverSession: (sessionID: string | undefined) => void
  },
) {
  return (
    <div class="w-full">
      <div
        ref={props.onSetSearchRoot}
        data-component="home-session-search"
        class="relative z-30 w-full"
        onFocusOut={(event) => props.onSearchBlur(event.relatedTarget)}
      >
        <Show when={props.searchOpen}>
          {/* Pressing in the panel keeps focus in the input, so the search stays open until a result opens. */}
          <div
            data-component="home-session-search-panel"
            onMouseDown={(event) => event.preventDefault()}
            class={`
              absolute flex flex-col overflow-hidden rounded-[12px]
              bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]
            `}
            style={{
              top: "-6px",
              "inset-inline-start": "-6px",
              width: "calc(100% + 12px)",
            }}
          >
            <div class="flex flex-col pt-9">
              <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col gap-4 pt-4">
                <Show
                  when={!props.searchLoading}
                  fallback={
                    <div class="flex items-center justify-center px-4 py-3 text-v2-text-text-muted [font-weight:440]">
                      <Loader class="size-4" />
                    </div>
                  }
                >
                  <Show
                    when={props.searchResults.length > 0}
                    fallback={
                      <p
                        class={`
                          my-1.5 px-4 pb-2 text-[13px] leading-4 tracking-[-0.04px]
                          text-v2-text-text-muted [font-weight:440]
                        `}
                      >
                        {props.searchNoResultsLabel}
                      </p>
                    }
                  >
                    <div class="flex flex-col">
                      <p
                        class={`
                          my-1.5 pl-[18px] pr-6 text-[13px] leading-4 tracking-[-0.04px]
                          text-v2-text-text-muted [font-weight:440]
                        `}
                      >
                        {props.language.t("home.sessions.search.sessions")}
                      </p>
                      <MenuScroll class="max-h-[min(20rem,40dvh)]" viewportRef={props.onSetSearchList}>
                        <div class="flex flex-col gap-px pb-2">
                          <For each={props.searchResults}>
                            {(record) => (
                              <HomeSessionSearchResultRow
                                {...props}
                                record={record}
                                selected={props.searchActive === homeSessionSearchKey(record)}
                              />
                            )}
                          </For>
                        </div>
                      </MenuScroll>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Show>
        <label
          class={`
            relative z-20 flex h-9 w-full items-center gap-2 rounded-[6px] py-1 ps-3 pe-2
            bg-v2-background-bg-layer-02/60 text-v2-icon-icon-muted transition-[background-color,box-shadow]
            duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-02 focus-within:bg-v2-background-bg-layer-02
          `}
        >
          <Icon name="magnifying-glass" />
          <input
            ref={props.onSetSearchInput}
            class={`
              relative z-20 min-w-0 flex-1 border-0 bg-transparent outline-0
              text-v2-text-text-base [font-weight:440] placeholder:text-v2-text-text-faint
            `}
            value={props.searchValue}
            placeholder={props.searchPlaceholder}
            aria-label={props.searchPlaceholder}
            aria-expanded={props.searchOpen}
            aria-controls={HOME_SESSION_SEARCH_RESULTS_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              props.searchActive && props.searchOpen ? `home-session-search-option-${props.searchActive}` : undefined
            }
            onFocus={props.onSearchFocus}
            onInput={(event) => props.onSearchInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                props.onSearchClose()
                event.currentTarget.blur()

                return
              }

              if (!props.searchOpen || props.searchResults.length === 0) return

              if (event.altKey || event.metaKey) return

              if (event.key === "ArrowDown") {
                event.preventDefault()
                props.onSearchMove(1)

                return
              }

              if (event.key === "ArrowUp") {
                event.preventDefault()
                props.onSearchMove(-1)

                return
              }

              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault()
                props.onSearchSelectActive()
              }
            }}
          />
          <Show when={props.searchValue}>
            <IconButton
              type="button"
              variant="ghost-muted"
              size="small"
              class="relative z-20 shrink-0"
              icon={<Icon name="close" size="large" class="text-v2-icon-icon-muted" />}
              aria-label={props.searchPlaceholder}
              onClick={() => {
                props.onSearchClose()
                props.onSearchFocus()
              }}
            />
          </Show>
        </label>
      </div>
    </div>
  )
}

function HomeSessionSearchResultRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    selected: boolean
    showLocations: boolean
    hoveredSession: string | undefined
    onHoverSession: (sessionID: string | undefined) => void
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const location = createMemo(() => props.location(props.record))
  const showProjectName = () => props.showProjectName && props.record.projectName
  const key = () => homeSessionSearchKey(props.record)

  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      data-project-name={!!showProjectName()}
      role="option"
      aria-selected={props.selected}
      class={`
        flex h-10 w-full shrink-0 cursor-default items-center border-0 py-3 pl-[18px] pr-6 text-left
        transition-[background-color] duration-[120ms] ease-in-out
        hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
      `}
      classList={{
        "bg-v2-overlay-simple-overlay-hover": props.selected,
        "gap-1.5": props.desktop,
        "gap-2": !props.desktop,
      }}
      onMouseEnter={() => {
        props.onSearchHighlight(props.record)
        props.onHoverSession(props.record.session.id)
        props.onRevealLocations(props.record)
      }}
      onMouseLeave={() => props.onHoverSession(undefined)}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onClick={(event) => props.onSearchSelect(props.record, { background: isBackgroundOpen(event) })}
      onAuxClick={(event) => {
        if (!isBackgroundOpen(event)) return
        event.preventDefault()
        props.onSearchSelect(props.record, { background: true })
      }}
    >
      <HomeSessionIndicators server={props.server} isOpenTab={props.isOpenTab} record={props.record} />
      <div data-slot="home-session-labels" class="flex min-w-0 flex-1 items-center gap-1.5">
        <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} search />
        <Show when={showProjectName()}>
          <HomeSessionProjectName name={props.record.projectName} trailing={props.desktop} search />
        </Show>
        <HomeSessionLocation
          location={location()}
          show={props.showLocations || props.hoveredSession === props.record.session.id}
          instantHide={
            !props.showLocations &&
            props.hoveredSession !== undefined &&
            props.hoveredSession !== props.record.session.id
          }
          desktop={props.desktop}
        />
      </div>
    </button>
  )
}

function HomeSessionGroupHeader(props: {
  title: string
  titleOpacity: number
  onSetRef: (element: HTMLDivElement) => void
  elevated?: boolean
}) {
  return (
    <div
      ref={props.onSetRef}
      class={`
        pointer-events-none sticky top-[68px] flex h-7 min-w-0 items-center justify-between
        bg-v2-background-bg-base ps-1.5 md:ps-3 md:top-[84px] lg:top-[108px]
      `}
      classList={{ "home-session-group-header z-[5]": !!props.elevated, "z-10": !props.elevated }}
    >
      <div class={HOME_SECTION_LABEL} style={{ opacity: props.titleOpacity }}>
        {props.title}
      </div>
    </div>
  )
}

function HomeSessionRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    rowState: HomeSessionRowState
    onRowEvent: (event: HomeSessionRowEvent) => void
    showLocations: boolean
    hoveredSession: string | undefined
    onHoverSession: (sessionID: string | undefined) => void
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const location = createMemo(() => props.location(props.record))
  const showProjectName = () => props.showProjectName && props.record.projectName
  const sessionID = () => props.record.session.id
  const menu = () => selectRowMenu(props.rowState, sessionID())
  const editor = () => selectRowEditor(props.rowState, sessionID())

  const openMenu = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect()
    props.onRowEvent({ type: "menu.open", sessionID: sessionID(), x: clientX - bounds.left, y: clientY - bounds.top })
  }

  return (
    <div
      data-component="home-session-row-container"
      data-project-name={!!showProjectName()}
      data-session-id={props.record.session.id}
      class="group/session relative flex h-10 min-w-0 items-center rounded-[6px] outline-none focus:outline-none focus-visible:outline-none"
      onContextMenu={(event) => {
        // While renaming, keep the native menu so paste and spelling work.
        if (editor()) return
        event.preventDefault()
        openMenu(event.currentTarget, event.clientX, event.clientY)
      }}
    >
      <Show
        when={!editor()}
        fallback={
          <div
            data-slot="home-session-editor"
            class="flex h-10 min-w-0 w-full flex-1 items-center py-3 ps-1.5 pe-3 md:ps-3"
            classList={{ "gap-1.5": props.desktop, "gap-2": !props.desktop, "md:pe-10": SHOW_HOME_SESSION_ARCHIVE }}
          >
            <HomeSessionIndicators server={props.server} isOpenTab={props.isOpenTab} record={props.record} />
            <div data-slot="home-session-labels" class="contents">
              <InlineInput
                data-component="home-session-rename"
                aria-label={props.language.t("common.rename")}
                dir="auto"
                value={editor()?.draft ?? ""}
                // Read-only rather than disabled keeps focus here while saving, so Escape can cancel the save.
                readOnly={editor()?.status === "renaming"}
                aria-busy={editor()?.status === "renaming" || undefined}
                class={`
                block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base
                [font-weight:530] field-sizing-content outline-none focus:outline-none focus-visible:outline-none
                 ${showProjectName() ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}
              `}
                style={{ "--inline-input-shadow": "none", "text-align": "start" }}
                onInput={(event) =>
                  props.onRowEvent({ type: "editor.input", sessionID: sessionID(), draft: event.currentTarget.value })
                }
                onKeyDown={(event) => {
                  event.stopPropagation()

                  // Enter and Escape during IME composition commit or cancel
                  // the composition, not the rename. Safari can report the
                  // composition-confirming keydown with isComposing false but
                  // keyCode 229.
                  if (event.isComposing || event.keyCode === 229) return

                  if (event.key === "Enter") {
                    event.preventDefault()
                    props.onRowEvent({
                      type: "editor.submit",
                      sessionID: sessionID(),
                      server: props.server,
                      session: props.record.session,
                      title: title(),
                    })

                    return
                  }

                  if (event.key !== "Escape") return
                  event.preventDefault()
                  props.onRowEvent({ type: "editor.cancel", sessionID: sessionID(), reason: "escape" })
                }}
                onBlur={() => props.onRowEvent({ type: "editor.cancel", sessionID: sessionID(), reason: "blur" })}
              />
              <Show when={showProjectName()}>
                <HomeSessionProjectName name={props.record.projectName} />
              </Show>
            </div>
          </div>
        }
      >
        <button
          type="button"
          data-component="home-session-row"
          aria-haspopup="menu"
          aria-expanded={!!menu()}
          class={`
            flex h-10 min-w-0 w-full flex-1 shrink-0 cursor-default items-center rounded-[6px] border-0
            bg-transparent py-3 ps-1.5 pe-3 md:ps-3 text-start text-v2-text-text-muted [font-weight:530]
            transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out
            hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
          `}
          classList={{ "gap-1.5": props.desktop, "gap-2": !props.desktop, "md:pe-10": SHOW_HOME_SESSION_ARCHIVE }}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault()
          }}
          onMouseEnter={() => {
            props.onHoverSession(props.record.session.id)
            props.onRevealLocations(props.record)
          }}
          onMouseLeave={() => props.onHoverSession(undefined)}
          onPointerDown={(event) => {
            if (event.pointerType !== "touch") return props.onRowEvent(POINTER_DOWN)
            const bounds = event.currentTarget.getBoundingClientRect()
            props.onRowEvent({
              type: "touch.down",
              sessionID: sessionID(),
              x: event.clientX,
              y: event.clientY,
              menuX: event.clientX - bounds.left,
              menuY: event.clientY - bounds.top,
            })
          }}
          onPointerMove={(event) => {
            // Checked first so a move inside the slop, or with no long press pending, allocates nothing.
            if (!selectLongPressMoved(props.rowState, event.clientX, event.clientY)) return
            props.onRowEvent({ type: "touch.move", x: event.clientX, y: event.clientY })
          }}
          onPointerUp={() => props.onRowEvent(TOUCH_UP)}
          onPointerCancel={() => props.onRowEvent(TOUCH_CANCEL)}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
            event.preventDefault()
            const bounds = event.currentTarget.getBoundingClientRect()
            openMenu(event.currentTarget, bounds.left + 12, bounds.bottom)
          }}
          onClick={(event) => {
            // The long press's release click arrives however late; keyboard activation is never that click.
            const suppress = selectRowSuppressClick(props.rowState, sessionID(), event.detail)
            props.onRowEvent({ type: "row.clicked", sessionID: sessionID() })

            if (suppress) {
              event.preventDefault()

              return
            }

            props.onOpenSession(props.record.session, { background: isBackgroundOpen(event) })
          }}
          onAuxClick={(event) => {
            if (!isBackgroundOpen(event)) return
            event.preventDefault()
            props.onOpenSession(props.record.session, { background: true })
          }}
        >
          <HomeSessionIndicators server={props.server} isOpenTab={props.isOpenTab} record={props.record} />
          <div
            data-slot="home-session-labels"
            class="min-w-0 flex-1 items-center gap-1.5"
            classList={{ flex: props.desktop, contents: !props.desktop }}
          >
            <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} />
            <Show when={showProjectName()}>
              <HomeSessionProjectName name={props.record.projectName} trailing={props.desktop} />
            </Show>
            <HomeSessionLocation
              location={location()}
              show={props.showLocations || props.hoveredSession === props.record.session.id}
              instantHide={
                !props.showLocations &&
                props.hoveredSession !== undefined &&
                props.hoveredSession !== props.record.session.id
              }
              desktop={props.desktop}
            />
          </div>
        </button>
      </Show>
      <Menu
        modal={false}
        placement="bottom-start"
        gutter={2}
        open={!!menu()}
        onOpenChange={(open) => {
          if (open) return
          props.onRowEvent({ type: "menu.closed", sessionID: sessionID() })
        }}
      >
        <Menu.Trigger
          as="span"
          aria-hidden="true"
          tabIndex={-1}
          class="pointer-events-none absolute size-px"
          style={{ left: `${menu()?.x ?? 0}px`, top: `${menu()?.y ?? 0}px` }}
        />
        <Menu.Portal>
          <Menu.Content
            onInteractOutside={() => props.onRowEvent({ type: "menu.interact-outside", sessionID: sessionID() })}
            // The trigger is an invisible positioning span, so Kobalte's close focus restore has no useful target;
            // closing the menu restores focus to the row instead.
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Menu.Item
              onSelect={() => props.onRowEvent({ type: "rename.start", sessionID: sessionID(), title: title() })}
            >
              {props.language.t("common.rename")}
            </Menu.Item>
            <Menu.Item onSelect={() => void props.onExportSession(props.server, props.record.session)}>
              {props.language.t("common.export")}…
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onSelect={() => props.onDeleteSession(props.server, props.record.session)}>
              {props.language.t("common.delete")}…
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      <Show when={SHOW_HOME_SESSION_ARCHIVE}>
        <div
          class={`
            hover-reveal absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1
            group-hover/session:opacity-100 focus-within:opacity-100
          `}
        >
          <Tooltip class="flex shrink-0 items-center" placement="bottom" value={props.language.t("common.archive")}>
            <IconButton
              data-action="home-session-archive"
              variant="ghost-muted"
              size="large"
              icon={<Icon name="archive" />}
              aria-label={props.language.t("common.archive")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void props.onArchiveSession(props.record.session)
              }}
            />
          </Tooltip>
        </div>
      </Show>
    </div>
  )
}

function HomeSessionTitle(props: { title: string; showProjectName: boolean; search?: boolean }) {
  return (
    <span
      data-component="home-session-title"
      dir="auto"
      class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:530]"
      classList={{
        "text-[13px] leading-4 tracking-[-0.04px]": !!props.search,
        "max-w-[min(70%,480px)] flex-[0_1_auto]": props.showProjectName,
        "flex-[1_1_auto]": !props.showProjectName,
      }}
    >
      {props.title}
    </span>
  )
}

function HomeSessionLocation(props: {
  location: { worktree: string; branch: string | undefined }
  show: boolean
  instantHide: boolean
  desktop: boolean
}) {
  if (!props.desktop) return null

  return (
    <span
      dir="ltr"
      aria-hidden={!props.show || undefined}
      class="flex min-w-0 shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap ease-out motion-reduce:transition-none"
      classList={{
        "-ms-1.5 max-w-0 opacity-0": !props.show,
        "max-w-[60%] opacity-100": props.show,
        "transition-[max-width,opacity] duration-[120ms]": !props.instantHide,
        "transition-none": props.instantHide,
      }}
    >
      <Icon name="outline-worktree" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 overflow-hidden text-ellipsis [font-weight:440]">{props.location.worktree}</span>
      <Show when={props.location.branch}>
        {(branch) => (
          <>
            <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 overflow-hidden text-ellipsis [font-weight:440]">{branch()}</span>
          </>
        )}
      </Show>
    </span>
  )
}

function HomeSessionProjectName(props: { name: string; search?: boolean; trailing?: boolean }) {
  return (
    <span
      data-component="home-session-project-name"
      dir="auto"
      class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted [font-weight:440]"
      classList={{
        "flex-[0_1_auto]": !!props.trailing,
        "flex-[1_1_auto]": !props.trailing,
        "text-[13px] leading-4 tracking-[-0.04px]": !!props.search,
      }}
    >
      {props.name}
    </span>
  )
}

function HomeSessionsEmpty(props: { onNewSession?: () => void; language: ReturnType<typeof useLanguage> }) {
  return (
    <div class="flex min-h-full flex-col items-center gap-4 px-6 pt-[52px] text-center">
      <div
        class={`
          shrink-0 text-[13px] leading-text-compact tracking-[-0.04px]
          text-v2-text-text-base [font-weight:530]
        `}
      >
        {props.language.t("home.sessions.empty")}
      </div>
      <p
        class={`
          mb-1 text-center text-[13px] leading-5 tracking-[-0.04px]
          text-v2-text-text-muted [font-weight:440]
        `}
      >
        {props.language.t("home.sessions.empty.description")}
      </p>
      <Show when={props.onNewSession}>
        {(onNewSession) => (
          <Button data-action="home-new-session" variant="neutral" size="normal" icon="edit" onClick={onNewSession()}>
            {props.language.t("command.session.new")}
          </Button>
        )}
      </Show>
    </div>
  )
}

// The list could not load, or the server cannot answer. Never the empty state, which offers to create a session.
function HomeSessionsUnavailable(props: {
  role: "alert" | "status"
  title: string
  description?: string
  onRetry?: () => void
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div
      data-component="home-sessions-unavailable"
      role={props.role}
      class="flex min-h-full flex-col items-center gap-4 px-6 pt-[52px] text-center"
    >
      <div class="shrink-0 text-[13px] leading-text-compact tracking-[-0.04px] text-v2-text-text-base [font-weight:530]">
        {props.title}
      </div>
      <Show when={props.description}>
        <p class="mb-1 text-center text-[13px] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
          {props.description}
        </p>
      </Show>
      <Show when={props.onRetry}>
        {(onRetry) => (
          <Button variant="neutral" size="normal" onClick={onRetry()}>
            {props.language.t("common.retry")}
          </Button>
        )}
      </Show>
    </div>
  )
}

function HomeSessionSkeleton(props: { visible: boolean; showProjectName: boolean; desktop: boolean }) {
  return (
    <div
      data-component="home-session-skeleton"
      data-visible={props.visible || undefined}
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 pt-1 pr-3 md:pt-3"
    >
      <div class="h-7" />
      <div class="flex min-w-0 flex-col gap-px pt-2 md:pt-4">
        <For each={HOME_SESSION_PLACEHOLDER_WIDTHS}>
          {(width) => (
            <div
              class="flex h-10 min-w-0 items-center ps-1.5 pe-3 md:ps-3 md:pe-10"
              classList={{ "gap-1.5": props.desktop, "gap-2": !props.desktop, "max-md:h-12": props.showProjectName }}
            >
              <span class="size-4 shrink-0 rounded-[4px] bg-v2-background-bg-layer-02" />
              <span class="h-2 rounded-full bg-v2-background-bg-layer-02" style={{ width: `${width}%` }} />
              <Show when={props.showProjectName}>
                <span class="h-2 w-16 shrink-0 rounded-full bg-v2-background-bg-layer-01" />
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
