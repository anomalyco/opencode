import { createEffect, createMemo, createSignal, Show, type JSX } from "solid-js"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { SessionReviewV2, SessionReviewV2Sidebar } from "@opencode-ai/session-ui/v2/session-review-v2"
import { SessionReviewFilePreviewV2 } from "@opencode-ai/session-ui/v2/session-review-file-preview-v2"
import { DiffChanges } from "@opencode-ai/ui/v2/diff-changes-v2"
import type {
  SessionReviewComment,
  SessionReviewCommentActions,
  SessionReviewCommentDelete,
  SessionReviewCommentUpdate,
  SessionReviewDiffStyle,
  SessionReviewFocus,
  SessionReviewLineComment,
} from "@opencode-ai/session-ui/session-review"
import FileTreeV2 from "@/components/file-tree-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  applyFileListKeyDown,
  filterRenderableDiff,
  filterReviewFiles,
  reviewDiffKinds,
} from "@/pages/session/v2/review-diff-kinds"
import {
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX,
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN,
  type ReviewPanelV2State,
} from "@/pages/session/v2/review-panel-v2-state"
import { SessionFileListV2 } from "@/pages/session/v2/session-file-list-v2"

export function makeReadFile(sdk: ReturnType<typeof useSDK>) {
  return async (path: string) =>
    sdk()
      .client.file
      .read({ path })
      .then((x) => x.data)
      .catch((error) => {
        console.debug("[session-review-v2] failed to read file", { path, error })
        return undefined
      })
}

type ReviewDiff = SnapshotFileDiff | VcsFileDiff

export type ReviewPanelV2Props = {
  title?: JSX.Element
  empty?: JSX.Element
  diffs: () => ReviewDiff[]
  diffsReady: () => boolean
  activeFile?: string
  onSelectFile: (path: string) => void
  diffStyle: SessionReviewDiffStyle
  onDiffStyleChange?: (style: SessionReviewDiffStyle) => void
  state: ReviewPanelV2State
  onLineComment?: (comment: SessionReviewLineComment) => void
  onLineCommentUpdate?: (comment: SessionReviewCommentUpdate) => void
  onLineCommentDelete?: (comment: SessionReviewCommentDelete) => void
  lineCommentActions?: SessionReviewCommentActions
  comments?: SessionReviewComment[]
  focusedComment?: SessionReviewFocus | null
  onFocusedCommentChange?: (focus: SessionReviewFocus | null) => void
}

function useReviewPanelV2Data(props: ReviewPanelV2Props) {
  const diffs = createMemo(() => props.diffs().filter(filterRenderableDiff))
  const diffFiles = createMemo(() => diffs().map((diff) => diff.file))
  const filteredFiles = createMemo(() => filterReviewFiles(diffFiles(), props.state.filter()))
  const searching = createMemo(() => props.state.filter().trim().length > 0)
  const kinds = createMemo(() => reviewDiffKinds(diffs()))
  const activeDiff = createMemo(() => {
    const active = props.activeFile
    if (searching()) return active
    const files = filteredFiles()
    if (active && files.includes(active)) return active
    return files[0]
  })
  const activeItem = createMemo(() => diffs().find((diff) => diff.file === activeDiff()))

  return { diffs, filteredFiles, searching, kinds, activeDiff, activeItem }
}

function useReviewPanelV2ActiveFile(
  props: ReviewPanelV2Props,
  filteredFiles: () => string[],
  searching: () => boolean,
) {
  createEffect(() => {
    if (searching()) return
    const files = filteredFiles()
    const active = props.activeFile
    if (files.length === 0) return
    if (active && files.includes(active)) return
    props.onSelectFile(files[0]!)
  })
}

export function ReviewPanelV2Sidebar(props: ReviewPanelV2Props) {
  const language = useLanguage()
  const model = useReviewPanelV2Data(props)
  const flatMode = createMemo(() => model.searching())
  const [highlightedPath, setHighlightedPath] = createSignal<string | undefined>()
  useReviewPanelV2ActiveFile(props, model.filteredFiles, model.searching)

  createEffect(() => {
    const files = model.filteredFiles()
    if (!flatMode() || files.length === 0) {
      if (highlightedPath()) setHighlightedPath(undefined)
      return
    }
    const highlighted = highlightedPath()
    if (highlighted && files.includes(highlighted)) return
    setHighlightedPath(files[0]!)
  })

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (!flatMode()) return
    applyFileListKeyDown(event, model.filteredFiles(), highlightedPath(), {
      onHighlight: setHighlightedPath,
      onSelect: props.onSelectFile,
    })
  }

  return (
    <SessionReviewV2Sidebar
      open={props.state.sidebarOpened()}
      title={props.title}
      stats={<DiffChanges changes={model.diffs()} />}
      filter={props.state.filter()}
      onFilterChange={props.state.setFilter}
      onFilterKeyDown={onFilterKeyDown}
      width={props.state.sidebarWidth()}
      onWidthChange={props.state.resizeSidebar}
      minWidth={REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN}
      maxWidth={REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX}
    >
      <Show
        when={props.diffsReady()}
        fallback={
          <div class="px-2 py-2 text-12-regular text-text-weak">
            {language.t("common.loading")}
            {language.t("common.loading.ellipsis")}
          </div>
        }
      >
        <Show
          when={flatMode()}
          fallback={
            <FileTreeV2
              path=""
              allowed={model.filteredFiles()}
              kinds={model.kinds()}
              showFolderChangeIndicator={false}
              draggable={false}
              active={model.activeDiff()}
              onFileClick={(node) => props.onSelectFile(node.path)}
            />
          }
        >
          <Show
            when={model.filteredFiles().length > 0}
            fallback={<div class="px-2 py-2 text-12-regular text-text-weak">{language.t("palette.empty")}</div>}
          >
            <SessionFileListV2
              files={model.filteredFiles()}
              kinds={model.kinds()}
              active={model.activeDiff()}
              highlighted={highlightedPath()}
              onFileClick={(path) => {
                setHighlightedPath(path)
                props.onSelectFile(path)
              }}
            />
          </Show>
        </Show>
      </Show>
    </SessionReviewV2Sidebar>
  )
}

export function ReviewPanelV2(props: ReviewPanelV2Props) {
  const sdk = useSDK()
  const model = useReviewPanelV2Data(props)
  const readFile = makeReadFile(sdk)

  return (
    <SessionReviewV2
      hideSidebar
      title={props.title}
      stats={<DiffChanges changes={model.diffs()} />}
      empty={props.empty}
      sidebarOpen={props.state.sidebarOpened()}
      filter={props.state.filter()}
      onFilterChange={props.state.setFilter}
      activeFile={model.activeDiff()}
      files={model.filteredFiles()}
      onSelectFile={props.onSelectFile}
      diffStyle={props.diffStyle}
      onDiffStyleChange={props.onDiffStyleChange}
      expandMode={props.state.expandMode()}
      onExpandModeChange={props.state.setExpandMode}
      hasDiffs={model.diffs().length > 0}
      preview={
        // Key on the file path, not the diff object identity, so refreshed diff data
        // updates the mounted preview instead of remounting the whole viewer.
        <Show when={model.activeDiff()} keyed>
          {(file) => (
            <Show when={model.activeItem()}>
              {(diff) => (
                <SessionReviewFilePreviewV2
                  file={file}
                  diff={diff()}
                  diffStyle={props.diffStyle}
                  expandMode={props.state.expandMode()}
                  readFile={readFile}
                  onLineComment={props.onLineComment}
                  onLineCommentUpdate={props.onLineCommentUpdate}
                  onLineCommentDelete={props.onLineCommentDelete}
                  lineCommentActions={props.lineCommentActions}
                  comments={props.comments}
                  focusedComment={props.focusedComment}
                  onFocusedCommentChange={props.onFocusedCommentChange}
                />
              )}
            </Show>
          )}
        </Show>
      }
    />
  )
}
