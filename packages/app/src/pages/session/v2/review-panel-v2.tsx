import { createMemo, createResource, createSignal, Show, type JSX } from "solid-js"
import type { FileDiffInfo, VcsFileDiff } from "@opencode-ai/sdk/v2"
import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
  SessionReviewV2,
  SessionReviewV2Sidebar,
} from "@opencode-ai/session-ui/v2/session-review-v2"
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
  filterReviewFiles,
  reviewDiffKinds,
  reviewDiffNeedsLoad,
  type RenderDiff,
} from "@/pages/session/v2/review-diff-kinds"
import type { ReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"
import { applyFileListKeyDown, SessionFileListV2 } from "@/pages/session/v2/session-file-list-v2"

type ReviewDiff = FileDiffInfo | VcsFileDiff

export type ReviewPanelV2Props = {
  title?: JSX.Element
  empty?: JSX.Element
  diffs: () => ReviewDiff[]
  diffsReady: () => boolean
  diffVersion?: number
  loadDiff?: (path: string, version?: number) => Promise<RenderDiff | undefined>
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

export function ReviewPanelV2(props: ReviewPanelV2Props) {
  const sdk = useSDK()

  const diffs = createMemo(() => props.diffs())
  const filteredFiles = createMemo(() =>
    filterReviewFiles(
      diffs().map((diff) => diff.file),
      props.state.filter(),
    ),
  )
  const searching = createMemo(() => props.state.filter().trim().length > 0)
  const kinds = createMemo(() => reviewDiffKinds(diffs()))
  // Changes-only trees omit "M" — every row is already a change; A/D stay visible.
  const treeKinds = createMemo(() => new Map([...kinds()].filter(([, kind]) => kind !== "mix")))
  const activeDiff = createMemo(() => {
    // A focused comment takes over the preview until the preview applies it and
    // clears the focus; the owner then persists the file as the active selection.
    const focus = props.focusedComment
    if (focus && diffs().some((diff) => diff.file === focus.file)) return focus.file
    const active = props.activeFile
    if (searching()) return active
    const files = filteredFiles()
    if (active && files.includes(active)) return active
    return files[0]
  })
  const sourceActiveItem = createMemo(() => diffs().find((diff) => diff.file === activeDiff()))
  const detailSource = createMemo(() => {
    const diff = sourceActiveItem()
    const load = props.loadDiff
    if (!diff || !load || !reviewDiffNeedsLoad(diff)) return
    return { diff, load, version: props.diffVersion }
  })
  const [loadedDiff] = createResource(detailSource, async ({ diff, load, version }) => {
    const value = await load(diff.file, version)
    if (value?.file !== diff.file) return
    return { source: diff, version, value }
  })

  const activeItem = createMemo(() => {
    const source = sourceActiveItem()
    if (loadedDiff.state !== "ready") return source
    const loaded = loadedDiff()
    if (loaded && loaded.source === source && loaded.version === props.diffVersion) return loaded.value
    return source
  })

  const readFile = async (path: string) =>
    sdk()
      .client.file.read({ path })
      .then((x) => x.data)
      .catch((error) => {
        console.debug("[session-review-v2] failed to read file", { path, error })
        return undefined
      })

  return (
    <SessionReviewV2
      title={props.title}
      stats={<DiffChanges changes={diffs()} />}
      empty={props.empty}
      sidebarOpen={props.state.sidebarOpened()}
      sidebar={
        // Always mounted: the sidebar header hosts the changes-mode dropdown,
        // which must stay reachable when the current mode has zero diffs.
        <ReviewPanelV2Sidebar
          title={props.title}
          state={props.state}
          diffsReady={props.diffsReady}
          onSelectFile={props.onSelectFile}
          diffs={diffs}
          filteredFiles={filteredFiles}
          searching={searching}
          kinds={treeKinds}
          activeDiff={activeDiff}
        />
      }
      activeFile={activeDiff()}
      files={filteredFiles()}
      onSelectFile={props.onSelectFile}
      diffStyle={props.diffStyle}
      onDiffStyleChange={props.onDiffStyleChange}
      expandMode={props.state.expandMode()}
      onExpandModeChange={props.state.setExpandMode}
      hasDiffs={diffs().length > 0}
      preview={
        // Key on the file path, not the diff object identity, so refreshed diff data
        // updates the mounted preview instead of remounting the whole viewer.
        <Show when={activeDiff()} keyed>
          {(file) => (
            <Show when={activeItem()}>
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

function ReviewPanelV2Sidebar(props: {
  title?: JSX.Element
  state: ReviewPanelV2State
  diffsReady: () => boolean
  onSelectFile: (path: string) => void
  diffs: () => RenderDiff[]
  filteredFiles: () => string[]
  searching: () => boolean
  kinds: () => ReturnType<typeof reviewDiffKinds>
  activeDiff: () => string | undefined
}) {
  const language = useLanguage()
  const [explicitHighlight, setExplicitHighlight] = createSignal<string | undefined>()
  const highlightedPath = createMemo(() => {
    if (!props.searching()) return undefined
    const files = props.filteredFiles()
    if (files.length === 0) return undefined
    const explicit = explicitHighlight()
    if (explicit && files.includes(explicit)) return explicit
    return files[0]
  })

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (!props.searching()) return
    applyFileListKeyDown(event, props.filteredFiles(), highlightedPath(), {
      onHighlight: setExplicitHighlight,
      onSelect: props.onSelectFile,
    })
  }

  return (
    <SessionReviewV2Sidebar
      open={props.state.sidebarOpened()}
      transition={props.state.sidebarTransition()}
      title={props.title}
      stats={<DiffChanges changes={props.diffs()} />}
      filter={props.state.filter()}
      onFilterChange={props.state.setFilter}
      onFilterKeyDown={onFilterKeyDown}
      width={props.state.sidebarWidth()}
      onWidthChange={props.state.resizeSidebar}
      minWidth={SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN}
      maxWidth={SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX}
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
          when={props.searching()}
          fallback={
            <FileTreeV2
              allowed={props.filteredFiles()}
              kinds={props.kinds()}
              draggable={false}
              active={props.activeDiff()}
              onFileClick={(node) => props.onSelectFile(node.path)}
            />
          }
        >
          <Show
            when={props.filteredFiles().length > 0}
            fallback={<div class="px-2 py-2 text-12-regular text-text-weak">{language.t("palette.empty")}</div>}
          >
            <SessionFileListV2
              files={props.filteredFiles()}
              kinds={props.kinds()}
              active={props.activeDiff()}
              highlighted={highlightedPath()}
              onFileClick={(path) => {
                setExplicitHighlight(path)
                props.onSelectFile(path)
              }}
            />
          </Show>
        </Show>
      </Show>
    </SessionReviewV2Sidebar>
  )
}
