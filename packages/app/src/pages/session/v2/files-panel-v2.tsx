import { createEffect, createMemo, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { SessionReviewV2Sidebar } from "@opencode-ai/ui/v2/session-review-v2"
import FileTreeV2 from "@/components/file-tree-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX,
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN,
  type ReviewPanelV2State,
} from "@/pages/session/v2/review-panel-v2-state"
import { filterRenderableDiff, reviewDiffKinds } from "@/pages/session/v2/review-diff-kinds"
import { SessionFileListV2 } from "@/pages/session/v2/session-file-list-v2"

type ReviewDiff = SnapshotFileDiff | VcsFileDiff

const SEARCH_DEBOUNCE_MS = 120
const SEARCH_LIMIT = 200

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "")
}

function searchErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Search failed. Please try again."
}

function searchErrorDetails(error: unknown) {
  const parts: string[] = []

  if (error instanceof Error) {
    parts.push(`error.message=${error.message}`)
    if (error.cause !== undefined) {
      parts.push(`error.cause=${searchErrorDetails(error.cause)}`)
    }
    if (error.stack) {
      const first = error.stack.split("\n")[1]?.trim()
      if (first) parts.push(`stack=${first}`)
    }
    return parts.join(" | ")
  }

  if (!error || typeof error !== "object") return String(error)

  const value = error as {
    name?: unknown
    message?: unknown
    status?: unknown
    data?: { message?: unknown }
    body?: { message?: unknown; error?: unknown }
    response?: { status?: unknown; statusText?: unknown }
  }
  const detail = [
    typeof value.name === "string" && value.name ? `name=${value.name}` : undefined,
    typeof value.message === "string" && value.message ? `message=${value.message}` : undefined,
    typeof value.data?.message === "string" && value.data.message ? `data.message=${value.data.message}` : undefined,
    typeof value.body?.message === "string" && value.body.message ? `body.message=${value.body.message}` : undefined,
    typeof value.body?.error === "string" && value.body.error ? `body.error=${value.body.error}` : undefined,
    typeof value.status === "number" ? `status=${value.status}` : undefined,
    typeof value.response?.status === "number" ? `response.status=${value.response.status}` : undefined,
    typeof value.response?.statusText === "string" && value.response.statusText
      ? `response.statusText=${value.response.statusText}`
      : undefined,
  ].filter((part): part is string => Boolean(part))

  if (detail.length > 0) return detail.join(" | ")
  return "unknown object error"
}

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
    const directory = sdk.directory
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

      void sdk.client.find
        .files({
          query: value,
          dirs: "false",
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
          console.error(`[files-panel-v2] file search failed query="${value}" ${searchErrorDetails(error)}`)
          setStore({
            files: [],
            loading: false,
            error: searchErrorMessage(error),
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
    const files = store.files
    if (files.length === 0) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const currentIndex = store.highlightedPath ? files.indexOf(store.highlightedPath) : -1
      const delta = event.key === "ArrowDown" ? 1 : -1
      const start = currentIndex === -1 ? (delta > 0 ? 0 : files.length - 1) : currentIndex + delta
      const index = Math.max(0, Math.min(files.length - 1, start))
      setStore("highlightedPath", files[index]!)
      event.preventDefault()
      return
    }

    if (event.key !== "Enter") return
    const target = store.highlightedPath ?? files[0]
    if (!target) return
    props.onOpenFile(target)
    event.preventDefault()
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
      <Show when={flatMode()}>
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
      <Show when={!flatMode()}>
        <FileTreeV2
          path=""
          modified={diffFiles()}
          kinds={kinds()}
          showModifiedLabel
          active={activeFile()}
          onFileClick={(node) => props.onOpenFile(node.path)}
          onFileDoubleClick={(node) => props.onOpenFilePersist?.(node.path)}
        />
      </Show>
    </SessionReviewV2Sidebar>
  )
}
