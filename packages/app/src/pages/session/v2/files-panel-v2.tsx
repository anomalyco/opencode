import { createEffect, createMemo, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { SessionReviewV2Sidebar } from "@opencode-ai/session-ui/v2/session-review-v2"
import FileTreeV2 from "@/components/file-tree-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX,
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN,
  type ReviewPanelV2State,
} from "@/pages/session/v2/review-panel-v2-state"
import {
  applyFileListKeyDown,
  filterRenderableDiff,
  normalizePath,
  reviewDiffKinds,
} from "@/pages/session/v2/review-diff-kinds"
import { SessionFileListV2 } from "@/pages/session/v2/session-file-list-v2"

type ReviewDiff = SnapshotFileDiff | VcsFileDiff

const SEARCH_DEBOUNCE_MS = 120
const SEARCH_LIMIT = 200

export type FilesPanelV2SidebarProps = {
  title: string | JSX.Element
  state: ReviewPanelV2State
  open?: boolean
  focusFilterToken?: number
  diffs: () => ReviewDiff[]
  activeFile?: string
  onOpenFile: (path: string) => void
  onOpenFilePersist?: (path: string) => void
}

export function FilesPanelV2Sidebar(props: FilesPanelV2SidebarProps) {
  const sdk = useSDK()
  const file = useFile()
  const language = useLanguage()
  const open = createMemo(() => props.open ?? props.state.sidebarOpened())
  const diffs = createMemo(() => props.diffs().filter(filterRenderableDiff))
  const diffFiles = createMemo(() => diffs().map((diff) => diff.file))
  const kinds = createMemo(() => reviewDiffKinds(diffs()))
  const query = createMemo(() => props.state.filesFilter().trim())
  const flatMode = createMemo(() => query().length > 0)
  const [store, setStore] = createStore({
    files: [] as string[],
    loading: false,
    error: undefined as string | undefined,
    highlightedPath: undefined as string | undefined,
  })

  createEffect(() => {
    const value = query()
    const directory = sdk().directory
    if (!directory || !value) {
      setStore({
        files: [],
        loading: false,
        error: undefined,
        highlightedPath: undefined,
      })
      return
    }

    let cancelled = false
    const timeout = setTimeout(() => {
      setStore("loading", true)

      void sdk()
        .client.find
        .files({
          query: value,
          dirs: "false",
          fallback: "glob",
          limit: SEARCH_LIMIT,
        })
        .then((response: { data?: string[] }) => {
          if (cancelled) return
          const normalized = (response.data ?? []).map(normalizePath)
          const unique = [...new Set(normalized)]
          setStore({
            files: unique,
            loading: false,
            error: undefined,
          })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          console.error(`[files-panel-v2] file search failed query="${value}"`, error)
          setStore({
            files: [],
            loading: false,
            error: error instanceof Error ? error.message : "Search failed. Please try again.",
            highlightedPath: undefined,
          })
        })
    }, SEARCH_DEBOUNCE_MS)

    onCleanup(() => {
      cancelled = true
      clearTimeout(timeout)
    })
  })

  createEffect(() => {
    const mode = flatMode()
    const files = store.files
    if (!mode || files.length === 0) {
      if (store.highlightedPath) setStore("highlightedPath", undefined)
      return
    }
    if (store.highlightedPath && files.includes(store.highlightedPath)) return
    setStore("highlightedPath", files[0]!)
  })

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (!flatMode()) return
    applyFileListKeyDown(event, store.files, store.highlightedPath, {
      onHighlight: (path) => setStore("highlightedPath", path),
      onSelect: props.onOpenFile,
    })
  }

  const activeFile = createMemo(() => {
    const active = props.activeFile
    if (!active) return
    return normalizePath(file.pathFromTab(active) ?? active)
  })

  return (
    <SessionReviewV2Sidebar
      variant="files"
      open={open()}
      title={props.title}
      filter={props.state.filesFilter()}
      onFilterChange={props.state.setFilesFilter}
      onFilterKeyDown={onFilterKeyDown}
      focusFilterToken={props.focusFilterToken}
      width={props.state.sidebarWidth()}
      onWidthChange={props.state.resizeSidebar}
      minWidth={REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN}
      maxWidth={REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX}
    >
      <Show
        when={flatMode()}
        fallback={
          <FileTreeV2
            path=""
            modified={diffFiles()}
            kinds={kinds()}
            showModifiedLabel
            active={activeFile()}
            onFileClick={(node) => props.onOpenFile(node.path)}
            onFileDoubleClick={(node) => props.onOpenFilePersist?.(node.path)}
          />
        }
      >
        <Show
          when={!store.loading}
          fallback={
            <div class="px-2 py-2 text-12-regular text-text-weak">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          }
        >
          <Show
            when={!store.error}
            fallback={<div class="px-2 py-2 text-12-regular text-text-danger">{store.error}</div>}
          >
            <Show
              when={store.files.length > 0}
              fallback={<div class="px-2 py-2 text-12-regular text-text-weak">{language.t("palette.empty")}</div>}
            >
              <SessionFileListV2
                files={store.files}
                kinds={kinds()}
                showModifiedLabel
                active={activeFile()}
                highlighted={store.highlightedPath}
                onFileClick={(path) => {
                  setStore("highlightedPath", path)
                  props.onOpenFile(path)
                }}
                onFileDoubleClick={props.onOpenFilePersist}
              />
            </Show>
          </Show>
        </Show>
      </Show>
    </SessionReviewV2Sidebar>
  )
}
