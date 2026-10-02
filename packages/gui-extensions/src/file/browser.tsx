import { createEffect, createMemo, createUniqueId, onCleanup, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery, keepPreviousData } from "@tanstack/solid-query"
import { Icon } from "@opencode/ui/icon"
import { SessionFilePanelV2, SessionFilePanelV2Empty } from "@opencode/session-ui/v2/session-file-panel-v2"
import { SessionReviewV2Sidebar } from "@opencode/session-ui/v2/session-review-v2"
import { getFilename } from "@opencode/util/path"
import type { ChangeKind } from "../review/contract"
import { useExtension, usePanel, type PanelSidebar, type PanelTab, type SessionView } from "../sdk"
import { useShared } from "./context"
import SessionFileList, { applyFileListKeyDown } from "./list"
import { fileTabPath, isFileTab } from "./path"
import FileTreeV2 from "./tree-v2"
import { SessionFileView } from "./view"

const emptyFiles: string[] = []

export function SessionFileBrowserTab(props: {
  session: SessionView
  /** The file tab to show; absent while browsing. */
  id?: string
  placeholder: boolean
  active?: string
  kinds: ReadonlyMap<string, ChangeKind>
  state: PanelSidebar
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  filterRef?: (element: HTMLInputElement) => void
  mobile?: boolean
}) {
  const ctx = useExtension()
  const file = props.session.file
  const resultsID = `session-file-browser-results-${createUniqueId()}`
  const [store, setStore] = createStore({ filter: "", explicitHighlight: undefined as string | undefined })
  const filter = () => store.filter
  const setFilter = (value: string) => setStore("filter", value)
  const setExplicitHighlight = (value: string) => setStore("explicitHighlight", value)
  const sidebarOpened = () => props.placeholder || props.state.opened()
  const query = createMemo(() => filter().trim())
  const search = createQuery(() => {
    const value = query()
    return {
      queryKey: [ctx.id, props.session.server.id, "session-open-file", file.root, value] as const,
      enabled: props.session.server.connected && value.length > 0,
      queryFn: ({ signal }) => file.search(value, { limit: 200, signal }),
      placeholderData: keepPreviousData,
    }
  })
  const files = createMemo(() => {
    if (!query() || search.isPending) return emptyFiles
    return [...new Set(search.data ?? emptyFiles)]
  })
  const highlighted = createMemo(() => {
    const values = files()
    if (values.length === 0) return undefined
    const explicit = store.explicitHighlight
    if (explicit && values.includes(explicit)) return explicit
    return values[0]
  })

  const loading = createMemo(() => query().length > 0 && search.isPending)
  const title = createMemo(() => {
    const project = props.session.listedProject ?? { worktree: file.root }
    return project.name || getFilename(project.worktree) || project.worktree
  })
  const optionID = (path: string) => `${resultsID}-option-${files().indexOf(path)}`

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
      toolbar={false}
      sidebar={
        <SessionReviewV2Sidebar
          open={sidebarOpened()}
          transition={props.state.transition()}
          title={<span class="truncate">{title()}</span>}
          filter={filter()}
          onFilterChange={setFilter}
          onFilterKeyDown={onFilterKeyDown}
          filterAutofocus={props.placeholder && !props.mobile}
          filterRef={(element) => props.filterRef?.(element)}
          filterControls={resultsID}
          filterActiveDescendant={highlighted() ? optionID(highlighted()!) : undefined}
          filterExpanded={query().length > 0 && files().length > 0}
          width={props.state.width()}
          onWidthChange={props.mobile ? undefined : props.state.resize}
        >
          <Show
            when={query()}
            fallback={
              <FileTreeV2
                session={props.session}
                active={props.active}
                kinds={props.kinds}
                draggable={!props.mobile}
                onFileClick={(node) => props.onSelect(node.path)}
                onFileDoubleClick={(node) => props.onSelectPermanent(node.path)}
              />
            }
          >
            <Show
              when={!loading()}
              fallback={
                <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                  {ctx.t("common.loading")}
                  {ctx.t("common.loading.ellipsis")}
                </div>
              }
            >
              <Show
                when={files().length > 0}
                fallback={
                  <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                    {ctx.t("palette.empty")}
                  </div>
                }
              >
                <SessionFileList
                  session={props.session}
                  id={resultsID}
                  role="listbox"
                  optionID={optionID}
                  files={files()}
                  kinds={props.kinds}
                  active={props.active}
                  highlighted={highlighted()}
                  onFileClick={(path) => {
                    setExplicitHighlight(path)
                    props.onSelect(path)
                  }}
                  onFileDoubleClick={props.onSelectPermanent}
                />
              </Show>
            </Show>
          </Show>
        </SessionReviewV2Sidebar>
      }
    >
      <Show
        when={!props.placeholder}
        fallback={
          <SessionFilePanelV2Empty>
            <div class="flex flex-col items-center gap-2 text-center text-text-weak">
              <Icon name="file-tree" size="large" class="mb-2" />
              <div class="text-[13px] font-medium leading-[13px] text-text-strong">{ctx.t("command.open")}</div>
              <div class="h-5 text-13-regular leading-5">{ctx.t("selectToOpen")}</div>
            </div>
          </SessionFilePanelV2Empty>
        }
      >
        <div class="min-h-0 flex-1">
          <Show when={props.id} keyed>
            {(id) => <SessionFileView session={props.session} id={id} />}
          </Show>
        </div>
      </Show>
    </SessionFilePanelV2>
  )
}

/** The side panel render every file tab and the "Open file" launcher share. */
export default function FileBrowser(props: { tab: Accessor<PanelTab>; session: SessionView }) {
  const panel = usePanel()
  const shared = useShared()
  const id = () => props.tab().id
  const placeholder = () => !isFileTab(id())
  const empty = new Map<string, ChangeKind>()

  // Change markers in the tree load while a file tab shows, as the side panel did.
  createEffect(() => {
    const changes = shared.changes()
    if (!changes || !panel.visible() || placeholder()) return
    onCleanup(changes.watch(props.session, "files"))
  })

  // Keep each file tab's last selection for the moment before a session's file view state loads.
  createEffect(() => {
    const file = props.session.file
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
    shared.handoff.set(props.session.key, files)
  })

  return (
    <SessionFileBrowserTab
      session={props.session}
      id={placeholder() ? undefined : id()}
      placeholder={placeholder()}
      active={placeholder() ? undefined : fileTabPath(props.session.file, id())}
      kinds={shared.changes()?.kinds(props.session) ?? empty}
      state={panel.sidebar}
      onSelect={(path) => shared.open(props.session, path, { preview: true })}
      onSelectPermanent={(path) => shared.open(props.session, path)}
      filterRef={(element) => {
        shared.filter.element = element
        if (!shared.filter.pending) return
        shared.filter.pending = false
        queueMicrotask(() => element.focus())
      }}
    />
  )
}
