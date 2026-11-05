import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
  type Accessor,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { SessionFilePanelV2, SessionFilePanelV2Empty } from "@opencode/session-ui/v2/session-file-panel-v2"
import { SessionReviewV2Sidebar, SessionReviewV2SidebarToggle } from "@opencode/session-ui/v2/session-review-v2"
import { getFilename } from "@opencode/util/path"
import { artifactKind } from "@opencode/util/artifact"
import type { ChangeKind } from "@opencode/plugin/gui/review"
import {
  createKeyed,
  usePlugin,
  usePanel,
  type MountedSession,
  type PanelSidebar,
  type PanelTab,
  type SessionScreen,
} from "@opencode/plugin/gui"
import { current, useShared } from "./context"
import SessionFileList, { applyFileListKeyDown } from "./list"
import { fileTabPath, isFileTab } from "./path"
import PierreFileTree from "./pierre-tree"
import {
  fileSearchView,
  INITIAL_FILE_SEARCH_STATE,
  sameFileSearchContext,
  transitionFileSearch,
  type FileSearchEffect,
  type FileSearchEvent,
  type FileSearchFailure,
  type FileSearchState,
} from "./search-machine"
import { SessionFileView } from "./view"

const emptyFiles: readonly string[] = []

export function SessionFileBrowserTab(props: {
  session: MountedSession
  screen: SessionScreen
  /** The file tab to show; absent while browsing. */
  id?: string
  placeholder: boolean
  active?: string
  kinds: ReadonlyMap<string, ChangeKind>
  state: PanelSidebar
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  /** The "Open file" focus request this view's filter input should take, if any. */
  focusRequest: () => number | undefined
  mobile?: boolean
}) {
  const ctx = usePlugin()
  const shared = useShared()
  const file = props.screen.file
  const resultsID = `session-file-browser-results-${createUniqueId()}`
  const [store, setStore] = createStore<{ explicitHighlight?: string; input?: HTMLInputElement }>({})
  const filter = () => shared.filter.get(props.session.key)
  const setFilter = (value: string) => shared.filter.set(props.session.key, value)
  const setExplicitHighlight = (value: string) => setStore("explicitHighlight", value)
  const sidebarOpened = () => props.placeholder || props.state.opened()
  const query = createMemo(() => filter().trim())

  // The filter's search. It asks the server directly: the screen's search reads a failure as no results.
  const [searchState, setSearchState] = createSignal<FileSearchState>(INITIAL_FILE_SEARCH_STATE)
  const searches = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const dispatchSearch = (event: FileSearchEvent) => {
    const next = transitionFileSearch(untrack(searchState), event)

    setSearchState(next.state)
    next.effects.forEach(runSearchEffect)
  }

  const runSearchEffect = (effect: FileSearchEffect) => {
    if (effect.type === "abort") {
      const request = searches.get(effect.attempt)

      searches.delete(effect.attempt)
      clearTimeout(request?.timer)
      request?.controller.abort()

      return
    }

    const attempt = effect.attempt
    const server = props.session.server

    const request = {
      controller: new AbortController(),
      timer: setTimeout(() => dispatchSearch({ type: "search.timed-out", attempt }), effect.timeoutMs),
    }

    const settle = () => {
      clearTimeout(request.timer)

      return searches.delete(attempt)
    }

    searches.set(attempt, request)
    // The workspace may change while the search runs; the machine keeps only the answer of its current attempt.
    void server.client.file
      .find(
        { location: { directory: effect.scope.root }, query: effect.query, type: "file", limit: 200 },
        { signal: AbortSignal.any([ctx.signal, request.controller.signal]) },
      )
      .then(
        (result) => {
          if (settle())
            dispatchSearch({
              type: "search.succeeded",
              attempt,
              files: result.data.map((entry) => file.resolve(entry.path)),
            })
        },
        (cause: unknown) => {
          if (settle())
            dispatchSearch({
              type: "search.failed",
              attempt,
              message: cause instanceof Error ? cause.message : String(cause),
            })
        },
      )
  }

  createKeyed(
    () => ({
      scope: { serverID: props.session.server.id, root: file.root },
      connected: props.session.server.connected,
      query: query(),
    }),
    (context) => dispatchSearch({ type: "context.changed", context }),
    { equals: sameFileSearchContext },
  )
  onCleanup(() => dispatchSearch({ type: "disposed" }))

  const searchView = createMemo(() => fileSearchView(searchState()))

  const failureText = (failure: FileSearchFailure) =>
    failure.type === "timeout" ? ctx.t("search.timeout") : failure.message

  const searchFailure = createMemo(() => {
    const view = searchView()

    return view.status === "error" ? view.failure : undefined
  })

  const results = createMemo(() => {
    const view = searchView()

    return view.status === "results" ? view : undefined
  })

  // Only current results take a pick: the previous query's stay inert while the next one loads.
  const files = createMemo(() => {
    const view = results()

    return view && !view.stale ? view.files : emptyFiles
  })

  const highlighted = createMemo(() => {
    const values = files()

    if (values.length === 0) return undefined
    const explicit = store.explicitHighlight

    if (explicit && values.includes(explicit)) return explicit

    return values[0]
  })

  const title = createMemo(() => {
    const project = props.session.listedProject ?? { worktree: file.root }

    return project.name || getFilename(project.worktree) || project.worktree
  })

  const optionID = (path: string) => `${resultsID}-option-${(results()?.files ?? emptyFiles).indexOf(path)}`

  // Moves keyboard focus to this view's own filter input once "Open file" asks this view for it and the input is
  // mounted; after the current render, so the input is in the document.
  createKeyed(
    () => {
      const input = store.input
      const request = props.focusRequest()

      return input && request !== undefined ? { input, request } : undefined
    },
    (target) =>
      queueMicrotask(() => {
        if (target.input.isConnected) target.input.focus()
        shared.filter.focused(target.request)
      }),
    { equals: (previous, next) => previous.input === next.input && previous.request === next.request },
  )

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape" && query()) {
      event.preventDefault()
      setFilter("")

      return
    }

    if (!query()) return
    applyFileListKeyDown(event, files(), highlighted(), {
      onHighlight: setExplicitHighlight,
      onSelect: props.onSelectPermanent,
    })
  }

  // Keep the sidebar outside Kobalte Tabs.Content: a morphing content value
  // unmounts the whole panel on every file-tab switch and resets sidebar scroll.
  return (
    <SessionFilePanelV2
      toolbar={!props.mobile && !props.placeholder && !sidebarOpened()}
      toolbarStart={<span class="truncate font-[530]">{title()}</span>}
      sidebarCollapsed={!sidebarOpened()}
      sidebarToggleGap={10}
      sidebarToggle={
        props.mobile ? undefined : (
          <SessionReviewV2SidebarToggle
            opened={sidebarOpened()}
            disabled={props.placeholder}
            onToggle={props.state.toggle}
          />
        )
      }
      sidebar={
        <SessionReviewV2Sidebar
          open={sidebarOpened()}
          transition={props.state.transition()}
          title={<span class="truncate font-[530]">{title()}</span>}
          filter={filter()}
          onFilterChange={setFilter}
          onFilterKeyDown={onFilterKeyDown}
          filterRef={(element) => setStore("input", element)}
          filterControls={resultsID}
          filterActiveDescendant={highlighted() ? optionID(highlighted()!) : undefined}
          filterExpanded={query().length > 0 && files().length > 0}
          width={props.state.width()}
          onWidthChange={props.mobile ? undefined : props.state.resize}
        >
          <Switch
            fallback={
              <PierreFileTree
                session={props.session}
                screen={props.screen}
                active={props.active}
                kinds={props.kinds}
                draggable={!props.mobile}
                onFileClick={(node) => props.onSelect(node.path)}
                onFileDoubleClick={(node) => props.onSelectPermanent(node.path)}
              />
            }
          >
            <Match when={searchView().status === "loading"}>
              <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                {ctx.t("common.loading")}
                {ctx.t("common.loading.ellipsis")}
              </div>
            </Match>
            <Match when={searchView().status === "offline"}>
              <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                {ctx.t("search.offline")}
              </div>
            </Match>
            <Match when={searchFailure()}>
              {(failure) => (
                <div role="alert" class="flex flex-col items-start gap-2 px-2 py-2">
                  <div class="flex flex-col gap-0.5">
                    <div class="text-12-medium text-text-strong">{ctx.t("search.failed")}</div>
                    <div class="text-12-regular text-text-weak break-words">{failureText(failure())}</div>
                  </div>
                  <Button size="small" variant="outline" onClick={() => dispatchSearch({ type: "retry" })}>
                    {ctx.t("common.retry")}
                  </Button>
                </div>
              )}
            </Match>
            <Match when={results()}>
              {(results) => (
                <Show
                  when={results().files.length > 0}
                  fallback={
                    <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                      {ctx.t("palette.empty")}
                    </div>
                  }
                >
                  {/* The previous query's results stay in place, dimmed and inert, while the next one loads. */}
                  <div
                    classList={{ "pointer-events-none opacity-60": results().stale }}
                    inert={results().stale || undefined}
                    aria-busy={results().stale || undefined}
                  >
                    <SessionFileList
                      session={props.session}
                      screen={props.screen}
                      id={resultsID}
                      role="listbox"
                      optionID={optionID}
                      files={results().files}
                      kinds={props.kinds}
                      active={props.active}
                      highlighted={highlighted()}
                      onFileClick={(path) => {
                        setExplicitHighlight(path)
                        props.onSelect(path)
                      }}
                      onFileDoubleClick={props.onSelectPermanent}
                    />
                  </div>
                </Show>
              )}
            </Match>
          </Switch>
        </SessionReviewV2Sidebar>
      }
    >
      <SessionFileViews session={props.session} screen={props.screen} id={props.id} placeholder={props.placeholder} />
    </SessionFilePanelV2>
  )
}

function SessionFileViews(props: {
  session: MountedSession
  screen: SessionScreen
  id?: string
  placeholder: boolean
}) {
  const ctx = usePlugin()
  const panel = usePanel()

  const scope = createMemo(
    () => ({ session: props.session.key, root: props.screen.file.root, screen: props.screen }),
    undefined,
    {
      equals: (previous, next) =>
        previous?.session === next.session && previous.root === next.root && previous.screen === next.screen,
    },
  )

  return (
    <Show when={scope()} keyed>
      {(scope) => {
        const offices = createMemo(() =>
          panel.open().filter((id) => {
            if (!isFileTab(id)) return false

            const kind = artifactKind(fileTabPath(scope.screen.file, id))

            return kind === "document" || kind === "spreadsheet" || kind === "presentation"
          }),
        )

        const selected = () => (props.placeholder ? undefined : props.id)

        const other = () => {
          const id = selected()

          return id && !offices().includes(id) ? id : undefined
        }

        return (
          <div class="relative min-h-0 flex-1">
            <Show when={props.placeholder}>
              <SessionFilePanelV2Empty>
                <div class="flex flex-col items-center gap-2 text-center text-text-weak">
                  <Icon name="file-tree" size="large" class="mb-2" />
                  <div class="text-[13px] font-medium leading-[13px] text-text-strong">{ctx.t("command.open")}</div>
                  <div class="h-5 text-13-regular leading-5">{ctx.t("selectToOpen")}</div>
                </div>
              </SessionFilePanelV2Empty>
            </Show>
            <Show when={other()} keyed>
              {(id) => <SessionFileView session={props.session} screen={props.screen} id={id} />}
            </Show>
            <For each={offices()}>
              {(id) => {
                // Selection history belongs to this open tab; closing it disposes the viewer and its worker.
                const visited = createMemo((previous) => previous || selected() === id, false)
                const active = () => selected() === id

                return (
                  <Show when={visited()}>
                    <div
                      class="absolute inset-0"
                      // Unlike display:none, this preserves the viewport geometry and its warm page canvases.
                      style={{ visibility: active() ? "visible" : "hidden" }}
                      inert={!active() || undefined}
                      aria-hidden={!active() || undefined}
                    >
                      <SessionFileView session={props.session} screen={props.screen} id={id} />
                    </div>
                  </Show>
                )
              }}
            </For>
          </div>
        )
      }}
    </Show>
  )
}

/** The side panel render every file tab and the "Open file" launcher share. */
export default function FileBrowser(props: {
  tab: Accessor<PanelTab>
  session: MountedSession
  screen: SessionScreen
}) {
  const panel = usePanel()
  const shared = useShared()
  const id = () => props.tab().id
  const placeholder = () => !isFileTab(id())
  const empty = new Map<string, ChangeKind>()
  const changes = () => current(shared.changes())

  // Change markers in the tree load while a file tab or the file browser shows.
  createKeyed(
    () => (panel.visible() ? changes() : undefined),
    (service) => onCleanup(service.watch(props.screen, "files")),
  )

  // Keep each file tab's last selection for the moment before a session's file view state loads. The handoff
  // outlives this view: the session's next view reads it.
  createKeyed(
    () => {
      const file = props.screen.file

      if (!file.ready()) return

      const files = Object.fromEntries(
        panel
          .open()
          .filter(isFileTab)
          .map((tab) => {
            const path = fileTabPath(file, tab)
            const selected = file.selection.get(path)

            return [path, selected && "start" in selected && "end" in selected ? selected : null] as const
          }),
      )

      return { session: props.session.key, files }
    },
    (handoff) => shared.handoff.set(handoff.session, handoff.files),
  )

  return (
    <SessionFileBrowserTab
      session={props.session}
      screen={props.screen}
      id={placeholder() ? undefined : id()}
      placeholder={placeholder()}
      active={placeholder() ? undefined : fileTabPath(props.screen.file, id())}
      kinds={changes()?.kinds(props.session) ?? empty}
      state={panel.sidebar}
      onSelect={(path) => shared.open(props.session, path, { tab: "preview" })}
      onSelectPermanent={(path) => shared.open(props.session, path)}
      focusRequest={() =>
        shared.filter.focusRequest({
          placement: "side",
          sessionKey: props.session.key,
          tabId: id(),
          visible: panel.visible(),
        })
      }
    />
  )
}
