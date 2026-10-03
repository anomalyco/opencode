import { createMemo, createResource, createSignal, Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
  SessionReviewV2,
  SessionReviewV2Sidebar,
  type SessionReviewExpandMode,
} from "@opencode/session-ui/v2/session-review-v2"
import { SessionReviewFilePreviewV2 } from "@opencode/session-ui/v2/session-review-file-preview-v2"
import { DiffChanges } from "@opencode/ui/diff-changes"
import type {
  SessionReviewComment,
  SessionReviewCommentActions,
  SessionReviewCommentDelete,
  SessionReviewCommentUpdate,
  SessionReviewDiffStyle,
  SessionReviewFocus,
  SessionReviewLineComment,
} from "@opencode/session-ui/session-review"
import { useExtension, usePanel, type MountedSession, type PanelSidebar, type SessionScreen } from "../sdk"
import type Review from "./index"
import {
  applyFileListKeyDown,
  filterReviewFiles,
  reviewDiffKinds,
  reviewDiffNeedsLoad,
  sortReviewPaths,
  type RenderDiff,
} from "./kinds"
import type { ReviewModel } from "./model"
import { ReviewPanelEmpty, ReviewTitle } from "./parts"

type ReviewPanelState = {
  sidebar: PanelSidebar
  filter: () => string
  setFilter: (value: string) => void
  expandMode: () => SessionReviewExpandMode
  setExpandMode: (mode: SessionReviewExpandMode) => void
}

type ReviewPanelProps = {
  session: MountedSession
  /** The session screen, whose workspace the panel reads files from. */
  screen: SessionScreen
  title?: JSX.Element
  empty?: JSX.Element
  /** Renderable diffs and their change kinds, computed once by the review model. */
  diffs: FileDiffInfo[]
  kinds: ReturnType<typeof reviewDiffKinds>
  diffsReady: boolean
  diffVersion?: number
  loadDiff?: (path: string, version?: number) => Promise<RenderDiff | undefined>
  activeFile?: string
  onSelectFile: (path: string) => void
  diffStyle: SessionReviewDiffStyle
  onDiffStyleChange?: (style: SessionReviewDiffStyle) => void
  state: ReviewPanelState
  onLineComment?: (comment: SessionReviewLineComment) => void
  onLineCommentUpdate?: (comment: SessionReviewCommentUpdate) => void
  onLineCommentDelete?: (comment: SessionReviewCommentDelete) => void
  lineCommentActions?: SessionReviewCommentActions
  comments?: SessionReviewComment[]
  focusedComment?: SessionReviewFocus | null
  onFocusedCommentChange?: (focus: SessionReviewFocus | null) => void
}

/** The desktop review panel. */
export default function ReviewPanelContent(props: {
  review: ReviewModel
  session: MountedSession
  diffStyle: SessionReviewDiffStyle
  onDiffStyleChange: (style: SessionReviewDiffStyle) => void
  expandMode: SessionReviewExpandMode
  onExpandModeChange: (mode: SessionReviewExpandMode) => void
}) {
  const panel = usePanel()

  return (
    <ReviewPanel
      session={props.session}
      screen={props.review.screen}
      title={<ReviewTitle review={props.review} />}
      empty={<ReviewPanelEmpty review={props.review} />}
      diffs={props.review.renderable()}
      kinds={props.review.kinds()}
      diffsReady={props.review.ready()}
      diffVersion={props.review.diffVersion()}
      loadDiff={props.review.loadDiff}
      activeFile={props.review.activeFile()}
      onSelectFile={props.review.focusFile}
      diffStyle={props.diffStyle}
      onDiffStyleChange={props.onDiffStyleChange}
      state={{
        sidebar: panel.sidebar,
        filter: props.review.filter,
        setFilter: props.review.setFilter,
        expandMode: () => props.expandMode,
        setExpandMode: props.onExpandModeChange,
      }}
      onLineComment={props.review.comments.add}
      onLineCommentUpdate={props.review.comments.update}
      onLineCommentDelete={props.review.comments.remove}
      lineCommentActions={props.review.comments.actions()}
      comments={props.review.comments.all()}
      focusedComment={props.review.comments.focus()}
      onFocusedCommentChange={props.review.comments.changeFocus}
    />
  )
}

function ReviewPanel(props: ReviewPanelProps) {
  const readFile = async (path: string) =>
    props.session.server.client.file
      .read({ path, location: { directory: props.screen.file.root } })
      .then((data) => ({ type: "text" as const, content: new TextDecoder().decode(data) }))
      .catch((error) => {
        console.debug("[session-review-v2] failed to read file", { path, error })

        return undefined
      })

  const diffs = () => props.diffs

  const filteredFiles = createMemo(() =>
    filterReviewFiles(
      diffs().map((diff) => diff.file),
      props.state.filter(),
    ),
  )

  const searching = createMemo(() => props.state.filter().trim().length > 0)
  const navigationFiles = createMemo(() => (searching() ? filteredFiles() : sortReviewPaths(filteredFiles())))
  const kinds = () => props.kinds
  // Changes-only trees omit "M" — every row is already a change; A/D stay visible.
  const treeKinds = createMemo(() => new Map([...kinds()].filter(([, kind]) => kind !== "mix")))

  const activeDiff = createMemo(() => {
    // A focused comment takes over the preview until the preview applies it and
    // clears the focus; the owner then persists the file as the active selection.
    const focus = props.focusedComment

    if (focus && diffs().some((diff) => diff.file === focus.file)) return focus.file
    const active = props.activeFile

    if (searching()) return active
    const files = navigationFiles()

    if (active && files.includes(active)) return active

    return files[0]
  })

  const sourceActiveItem = createMemo(() => diffs().find((diff) => diff.file === activeDiff()))

  const detailSource = createMemo(() => {
    const diff = sourceActiveItem()
    const load = props.loadDiff

    if (!diff || !load || !reviewDiffNeedsLoad(diff)) return undefined

    return { diff, load, version: props.diffVersion }
  })

  const [loadedDiff] = createResource(detailSource, async ({ diff, load, version }) => {
    const value = await load(diff.file, version)

    if (value?.file !== diff.file) return undefined

    return { source: diff, version, value }
  })

  const activeItem = createMemo(() => {
    const source = sourceActiveItem()

    if (loadedDiff.state !== "ready") return source
    const loaded = loadedDiff()

    if (loaded && loaded.source === source && loaded.version === props.diffVersion) return loaded.value

    return source
  })

  return (
    <SessionReviewV2
      title={props.title}
      stats={<DiffChanges changes={diffs()} />}
      empty={props.empty}
      sidebarOpen={props.state.sidebar.opened()}
      sidebar={
        // Always mounted: the sidebar header hosts the changes-mode dropdown,
        // which must stay reachable when the current mode has zero diffs.
        <ReviewPanelSidebar
          session={props.session}
          title={props.title}
          state={props.state}
          diffsReady={props.diffsReady}
          onSelectFile={props.onSelectFile}
          diffs={diffs()}
          filteredFiles={filteredFiles()}
          searching={searching()}
          kinds={treeKinds()}
          activeDiff={activeDiff()}
        />
      }
      activeFile={activeDiff()}
      files={navigationFiles()}
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

function ReviewPanelSidebar(props: {
  session: MountedSession
  title?: JSX.Element
  state: ReviewPanelState
  diffsReady: boolean
  onSelectFile: (path: string) => void
  diffs: RenderDiff[]
  filteredFiles: string[]
  searching: boolean
  kinds: ReturnType<typeof reviewDiffKinds>
  activeDiff: string | undefined
}) {
  const ctx = useExtension<typeof Review>()

  // The file extension draws the change tree; while it is unavailable the list stays empty.
  const views = () => {
    const tree = ctx.uses.tree()

    return tree.status === "active" ? tree.value : undefined
  }

  const [explicitHighlight, setExplicitHighlight] = createSignal<string | undefined>()

  const highlightedPath = createMemo(() => {
    if (!props.searching) return undefined
    const files = props.filteredFiles

    if (files.length === 0) return undefined
    const explicit = explicitHighlight()

    if (explicit && files.includes(explicit)) return explicit

    return files[0]
  })

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (!props.searching) return
    applyFileListKeyDown(event, props.filteredFiles, highlightedPath(), {
      onHighlight: setExplicitHighlight,
      onSelect: props.onSelectFile,
    })
  }

  return (
    <SessionReviewV2Sidebar
      open={props.state.sidebar.opened()}
      transition={props.state.sidebar.transition()}
      title={props.title}
      stats={<DiffChanges changes={props.diffs} />}
      filter={props.state.filter()}
      onFilterChange={props.state.setFilter}
      onFilterKeyDown={onFilterKeyDown}
      width={props.state.sidebar.width()}
      onWidthChange={props.state.sidebar.resize}
      minWidth={SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN}
      maxWidth={SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX}
    >
      <Show
        when={props.diffsReady}
        fallback={
          <div class="px-2 py-2 text-12-regular text-text-weak">
            {ctx.t("common.loading")}
            {ctx.t("common.loading.ellipsis")}
          </div>
        }
      >
        <Show
          when={props.searching}
          fallback={
            <Show when={views()}>
              {(views) => (
                <Dynamic
                  component={views().Tree}
                  session={props.session}
                  allowed={props.filteredFiles}
                  kinds={props.kinds}
                  active={props.activeDiff}
                  onFileClick={props.onSelectFile}
                />
              )}
            </Show>
          }
        >
          <Show
            when={props.filteredFiles.length > 0}
            fallback={<div class="px-2 py-2 text-12-regular text-text-weak">{ctx.t("palette.empty")}</div>}
          >
            <Show when={views()}>
              {(views) => (
                <Dynamic
                  component={views().List}
                  session={props.session}
                  files={props.filteredFiles}
                  kinds={props.kinds}
                  active={props.activeDiff}
                  highlighted={highlightedPath()}
                  onFileClick={(path: string) => {
                    setExplicitHighlight(path)
                    props.onSelectFile(path)
                  }}
                />
              )}
            </Show>
          </Show>
        </Show>
      </Show>
    </SessionReviewV2Sidebar>
  )
}
