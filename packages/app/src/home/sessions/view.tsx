import type { SessionInfo } from "@opencode-ai/client/promise"
import { Key } from "@solid-primitives/keyed"
import { createMemo, For, Index, onCleanup, Show, Suspense } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Menu } from "@opencode-ai/ui/menu"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { sessionLabel } from "@/session/title"
import { shouldOpenSessionInBackground } from "./open"
import {
  HomeSessionStatusController,
  homeSessionSearchKey,
  type HomeSessionGroup,
  type HomeSessionRecord,
  type OpenSessionOptions,
} from "./controller"

const SHOW_HOME_SESSION_ARCHIVE = false
const HOME_SECTION_LABEL = "text-v2-text-text-muted [font-weight:440]"
const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"
const HOME_SESSION_LONG_PRESS_MS = 500

// Middle-click or Cmd+click on macOS (Ctrl+click elsewhere) opens a session
// tab in the background without navigating, matching browser conventions.
function isBackgroundOpen(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

export type HomeSessionsViewProps = {
  language: ReturnType<typeof useLanguage>
  groups: HomeSessionGroup[]
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
  searchIncludeArchived: boolean
  titleOpacity: (id: HomeSessionGroup["id"]) => number
  isOpenTab: (record: HomeSessionRecord) => boolean
  onCreateSession: () => void
  onOpenSession: (session: SessionInfo, options?: OpenSessionOptions) => void
  onArchiveSession: (session: SessionInfo) => Promise<void>
  onRenameSession: (server: ServerConnection.Key, session: SessionInfo, title: string) => Promise<boolean>
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
  onSearchInput: (value: string) => void
  onSearchClose: () => void
  onSearchIncludeArchived: (value: boolean) => void
  onSearchMove: (delta: number) => void
  onSearchSelectActive: () => void
  onSearchHighlight: (record: HomeSessionRecord) => void
  onSearchSelect: (record: HomeSessionRecord, options?: OpenSessionOptions) => void
}

// Session store updates recreate row components, so row-local state would
// close an open context menu or drop an in-progress rename. Keep both keyed
// by session ID at the view root, like the projects list does.
type HomeSessionRowUI = {
  menu: { id: string; x: number; y: number } | undefined
  editor: { id: string; draft: string; renaming: boolean } | undefined
}

export function HomeSessionsView(props: HomeSessionsViewProps) {
  const [rowUI, setRowUI] = createStore<HomeSessionRowUI>({ menu: undefined, editor: undefined })
  return (
    <section
      ref={props.onSetHoverTarget}
      class="min-h-0 min-w-0 flex-1 flex flex-col"
      aria-label={props.language.t("sidebar.project.recentSessions")}
    >
      <div class="sticky top-0 z-30 shrink-0 bg-v2-background-bg-base pb-3 pt-6 lg:pt-12" onWheel={props.onWheel}>
        <HomeSessionSearch {...props} />
        <Suspense>
          <Show when={props.groups.length > 0 && props.canCreateSession}>
            <div class="pointer-events-none absolute right-0 top-[84px] z-20 flex lg:top-[108px]">
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
        </Suspense>
      </div>
      <div class="pointer-events-none sticky top-[84px] z-40 h-0 -mr-3 lg:top-[108px]">
        <div
          ref={props.onSetThumbTrack}
          data-component="home-session-scroll-track"
          class="relative ml-auto h-[calc(100cqh-84px)] w-3 lg:h-[calc(100cqh-108px)]"
        />
      </div>
      <div class="-mr-3 min-h-[calc(100cqh-72px)] lg:min-h-[calc(100cqh-96px)]">
        <Suspense
          fallback={
            <div class="pt-3">
              <HomeSessionSkeleton label={props.language.t("common.loading")} />
            </div>
          }
        >
          <Show
            when={props.groups.length > 0}
            fallback={
              <HomeSessionsEmpty
                onNewSession={props.canCreateSession ? props.onCreateSession : undefined}
                language={props.language}
              />
            }
          >
            <div ref={props.onSetContent} class="flex flex-col pt-3 pr-3 pb-16">
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
                    <div class={`flex min-w-0 flex-col gap-px pt-4 ${index === props.groups.length - 1 ? "" : "mb-6"}`}>
                      {/* Rows key by session ID: session.sync replaces the
                          stored session object wholesale, so reference-keyed
                          rows would be disposed mid-interaction whenever a
                          sync response lands. */}
                      <Key each={group().sessions} by={(record) => record.session.id}>
                        {(record) => <HomeSessionRow {...props} record={record()} rowUI={rowUI} setRowUI={setRowUI} />}
                      </Key>
                    </div>
                  </>
                )}
              </Index>
            </div>
          </Show>
        </Suspense>
      </div>
    </section>
  )
}

function HomeSessionLeadingController(props: {
  server: HomeSessionsViewProps["server"]
  isOpenTab: HomeSessionsViewProps["isOpenTab"]
  record: HomeSessionRecord
  revealProjectOnHover: boolean
}) {
  return (
    <HomeSessionStatusController
      server={props.server}
      record={props.record}
      isOpenTab={props.isOpenTab}
      render={(state) => (
        <HomeSessionLeading
          record={props.record}
          revealProjectOnHover={props.revealProjectOnHover}
          open={state.open()}
          unread={state.unread()}
          loading={state.loading()}
        />
      )}
    />
  )
}

function HomeSessionLeading(props: {
  record: HomeSessionRecord
  revealProjectOnHover: boolean
  open: boolean
  unread: boolean
  loading: boolean
}) {
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
        revealProjectOnHover={props.revealProjectOnHover}
        unread={props.unread}
        loading={props.loading}
      />
    </div>
  )
}

function HomeSessionSearch(props: HomeSessionsViewProps) {
  return (
    <div class="w-full">
      <div ref={props.onSetSearchRoot} data-component="home-session-search" class="relative z-30 w-full">
        <Show when={props.searchOpen}>
          <div
            data-component="home-session-search-panel"
            class={`
              absolute flex flex-col overflow-hidden rounded-[12px]
              bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]
            `}
            style={{ top: "-6px", left: "-6px", width: "calc(100% + 12px)" }}
          >
            <div class="flex flex-col pt-9">
              <div
                class={`
                  my-1.5 flex items-center justify-between gap-3 pl-[18px] pr-4
                  text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]
                `}
              >
                <span>{props.language.t("home.sessions.search.sessions")}</span>
                <Switch checked={props.searchIncludeArchived} onChange={props.onSearchIncludeArchived}>
                  {props.language.t("home.sessions.search.includeArchived")}
                </Switch>
              </div>
              <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col gap-4 pt-4">
                <Show
                  when={!props.searchLoading}
                  fallback={
                    <div class="flex items-center justify-center px-4 py-3 text-v2-text-text-muted [font-weight:440]">
                      <Spinner class="size-4" />
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
                      <ScrollView class="max-h-80" viewportRef={props.onSetSearchList}>
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
                      </ScrollView>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Show>
        <label
          class={`
            relative z-20 flex h-9 w-full items-center gap-2 rounded-[6px] py-1 pl-3 pr-2
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
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const showProjectName = () => props.showProjectName && props.record.projectName
  const key = () => homeSessionSearchKey(props.record)

  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      role="option"
      aria-selected={props.selected}
      class={`
        flex h-10 w-full shrink-0 cursor-default items-center gap-2 border-0 py-3 pl-[18px] pr-6 text-left
        transition-[background-color] duration-[120ms] ease-in-out
        hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
      `}
      classList={{
        "bg-v2-overlay-simple-overlay-hover": props.selected,
        group: !!showProjectName(),
      }}
      onMouseEnter={() => props.onSearchHighlight(props.record)}
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
      <HomeSessionLeadingController
        server={props.server}
        isOpenTab={props.isOpenTab}
        record={props.record}
        revealProjectOnHover={!!showProjectName()}
      />
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} search />
        <Show when={showProjectName()}>
          <HomeSessionProjectName name={props.record.projectName} search />
        </Show>
      </div>
      <Show when={props.record.session.time.archived}>
        <span
          class={`
            flex shrink-0 items-center gap-1 text-[11px] leading-4 tracking-[0.05px]
            text-v2-text-text-faint [font-weight:440]
          `}
        >
          <Icon name="archive" size="small" />
          {props.language.t("home.sessions.search.archived")}
        </span>
      </Show>
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
        pointer-events-none sticky top-[84px] flex h-7 min-w-0 items-center justify-between
        bg-v2-background-bg-base pl-3 lg:top-[108px]
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
    rowUI: HomeSessionRowUI
    setRowUI: SetStoreFunction<HomeSessionRowUI>
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const showProjectName = () => props.showProjectName && props.record.projectName
  const sessionID = () => props.record.session.id
  const menu = () => (props.rowUI.menu?.id === sessionID() ? props.rowUI.menu : undefined)
  const editor = () => (props.rowUI.editor?.id === sessionID() ? props.rowUI.editor : undefined)
  let longPressTimer: ReturnType<typeof setTimeout> | undefined
  let longPressStart: { x: number; y: number } | undefined
  let suppressClick = false
  let menuInteractedOutside = false

  // Focus targets are looked up by session ID: session store updates recreate
  // row components, so instance refs can point at detached nodes by the time
  // deferred focus runs.
  const rowSelector = () => `[data-component="home-session-row-container"][data-session-id="${sessionID()}"]`
  const rowButton = () =>
    document.querySelector<HTMLButtonElement>(`${rowSelector()} [data-component="home-session-row"]`)
  const renameInput = () =>
    document.querySelector<HTMLInputElement>(`${rowSelector()} [data-component="home-session-rename"]`)

  const clearLongPress = () => {
    if (longPressTimer !== undefined) clearTimeout(longPressTimer)
    longPressTimer = undefined
    longPressStart = undefined
  }
  onCleanup(clearLongPress)

  const openMenu = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect()
    props.setRowUI("menu", { id: sessionID(), x: clientX - bounds.left, y: clientY - bounds.top })
  }

  const openEditor = () => {
    props.setRowUI("editor", { id: sessionID(), draft: title(), renaming: false })
    requestAnimationFrame(() => {
      const input = renameInput()
      input?.focus()
      input?.select()
    })
  }
  const closeEditor = () => {
    if (editor()?.renaming) return
    props.setRowUI("editor", (value) => (value?.id === sessionID() ? undefined : value))
  }
  const saveEditor = async () => {
    const current = editor()
    if (!current || current.renaming) return
    props.setRowUI("editor", { ...current, renaming: true })
    const saved = await props.onRenameSession(props.server, props.record.session, current.draft)
    // Disabling the input during the request drops focus to the body; restore
    // it unless the user focused another control while the rename was pending.
    const restore = document.activeElement === document.body || document.activeElement === renameInput()
    props.setRowUI("editor", (value) => {
      if (value?.id !== sessionID()) return value
      return saved ? undefined : { ...value, renaming: false }
    })
    if (!restore) return
    requestAnimationFrame(() => {
      if (saved) {
        rowButton()?.focus()
        return
      }
      renameInput()?.focus()
    })
  }

  return (
    <div
      data-component="home-session-row-container"
      data-session-id={props.record.session.id}
      class="group/session relative flex h-10 min-w-0 items-center rounded-[6px] outline-none focus:outline-none focus-visible:outline-none"
      classList={{ group: !!showProjectName() }}
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
          <div class="flex h-10 min-w-0 w-full flex-1 items-center gap-2 py-3 pl-3 pr-10">
            <HomeSessionLeadingController
              server={props.server}
              isOpenTab={props.isOpenTab}
              record={props.record}
              revealProjectOnHover={false}
            />
            <InlineInput
              data-component="home-session-rename"
              aria-label={props.language.t("common.rename")}
              dir="auto"
              value={editor()?.draft ?? ""}
              disabled={editor()?.renaming ?? false}
              class={`
                block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base
                [font-weight:530] field-sizing-content outline-none focus:outline-none focus-visible:outline-none
                ${showProjectName() ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}
              `}
              style={{ "--inline-input-shadow": "none", "text-align": "start" }}
              onInput={(event) => {
                const draft = event.currentTarget.value
                props.setRowUI("editor", (value) => (value?.id === sessionID() ? { ...value, draft } : value))
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                // Enter and Escape during IME composition commit or cancel
                // the composition, not the rename. Safari can report the
                // composition-confirming keydown with isComposing false but
                // keyCode 229.
                if (event.isComposing || event.keyCode === 229) return
                if (event.key === "Enter") {
                  event.preventDefault()
                  void saveEditor()
                  return
                }
                if (event.key !== "Escape") return
                event.preventDefault()
                closeEditor()
                requestAnimationFrame(() => rowButton()?.focus())
              }}
              onBlur={closeEditor}
            />
            <Show when={showProjectName()}>
              <HomeSessionProjectName name={props.record.projectName} />
            </Show>
          </div>
        }
      >
        <button
          type="button"
          data-component="home-session-row"
          aria-haspopup="menu"
          aria-expanded={!!menu()}
          class={`
            flex h-10 min-w-0 w-full flex-1 shrink-0 cursor-default items-center gap-2 rounded-[6px] border-0
            bg-transparent py-3 pl-3 pr-10 text-left text-v2-text-text-muted [font-weight:530]
            transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out
            hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
          `}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault()
          }}
          onPointerDown={(event) => {
            suppressClick = false
            if (event.pointerType !== "touch") return
            clearLongPress()
            const element = event.currentTarget
            const x = event.clientX
            const y = event.clientY
            longPressStart = { x, y }
            longPressTimer = setTimeout(() => {
              suppressClick = true
              clearLongPress()
              openMenu(element, x, y)
            }, HOME_SESSION_LONG_PRESS_MS)
          }}
          onPointerMove={(event) => {
            if (!longPressStart) return
            if (Math.abs(event.clientX - longPressStart.x) <= 8 && Math.abs(event.clientY - longPressStart.y) <= 8)
              return
            clearLongPress()
          }}
          onPointerUp={clearLongPress}
          onPointerCancel={() => {
            clearLongPress()
            suppressClick = false
          }}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
            event.preventDefault()
            const bounds = event.currentTarget.getBoundingClientRect()
            openMenu(event.currentTarget, bounds.left + 12, bounds.bottom)
          }}
          onClick={(event) => {
            // The flag stays set until the long-press compatibility click
            // arrives, however delayed; keyboard activation (detail 0) is
            // never that click and passes through.
            if (suppressClick) {
              suppressClick = false
              if (event.detail !== 0) {
                event.preventDefault()
                return
              }
            }
            props.onOpenSession(props.record.session, { background: isBackgroundOpen(event) })
          }}
          onAuxClick={(event) => {
            if (!isBackgroundOpen(event)) return
            event.preventDefault()
            props.onOpenSession(props.record.session, { background: true })
          }}
        >
          <HomeSessionLeadingController
            server={props.server}
            isOpenTab={props.isOpenTab}
            record={props.record}
            revealProjectOnHover={!!showProjectName()}
          />
          <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} />
          <Show when={showProjectName()}>
            <HomeSessionProjectName name={props.record.projectName} />
          </Show>
        </button>
      </Show>
      <Menu
        modal={false}
        placement="bottom-start"
        gutter={2}
        open={!!menu()}
        onOpenChange={(open) => {
          if (open) return
          props.setRowUI("menu", (value) => (value?.id === sessionID() ? undefined : value))
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
            onInteractOutside={() => {
              menuInteractedOutside = true
            }}
            onCloseAutoFocus={(event) => {
              // The trigger is an invisible positioning span, so Kobalte's
              // default close focus restore has no useful target. Skip the
              // row focus when the rename editor owns focus or the user
              // dismissed the menu by interacting elsewhere.
              event.preventDefault()
              const outside = menuInteractedOutside
              menuInteractedOutside = false
              if (outside || editor()) return
              requestAnimationFrame(() => rowButton()?.focus())
            }}
          >
            <Menu.Item onSelect={openEditor}>{props.language.t("common.rename")}</Menu.Item>
            <Menu.Item onSelect={() => void props.onExportSession(props.server, props.record.session)}>
              {props.language.t("common.export")}...
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onSelect={() => props.onDeleteSession(props.server, props.record.session)}>
              {props.language.t("common.delete")}...
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

function HomeSessionProjectName(props: { name: string; search?: boolean }) {
  return (
    <span
      class="min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted [font-weight:440]"
      classList={{ "text-[13px] leading-4 tracking-[-0.04px]": !!props.search }}
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

function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex h-7 min-w-0 items-center justify-between px-4">
        <div class={HOME_SECTION_LABEL}>{props.label}</div>
      </div>
      <div class="flex min-w-0 flex-col gap-px" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => <div class="h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70" />}</For>
      </div>
    </div>
  )
}
