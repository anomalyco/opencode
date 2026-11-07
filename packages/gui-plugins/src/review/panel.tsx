import { createMemo, createSignal, Match, onCleanup, Show, Switch, untrack, type JSX } from "solid-js"
import { Loader } from "@opencode/ui/loader"
import { Dynamic } from "solid-js/web"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
  SessionReviewV2,
  SessionReviewV2Sidebar,
  SessionReviewV2SidebarToggle,
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
import {
  createKeyed,
  usePlugin,
  usePanel,
  type MountedSession,
  type PanelSidebar,
  type SessionScreen,
} from "@opencode/plugin/gui"
import { FileTree, OpenInApp } from "@opencode/plugin/gui/file"
import type Review from "./index"
import {
  applyFileListKeyDown,
  filterReviewFiles,
  isReviewFolder,
  reviewDiffKinds,
  reviewDiffNeedsLoad,
  sortReviewPaths,
  type RenderDiff,
} from "./kinds"
import {
  INITIAL_REVIEW_DETAIL_STATE,
  reviewDetailView,
  sameReviewDetailTarget,
  transitionReviewDetail,
  type ReviewDetailEffect,
  type ReviewDetailEvent,
  type ReviewDetailState,
} from "./detail-machine"
import { REVIEW_DIFF_TIMEOUT_MS, type ReviewDiffView } from "./machine"
import type { ReviewModel } from "./model"
import { ReviewFailure, ReviewPanelEmpty, ReviewTitle } from "./parts"

/** A full patch request: its backoff, then its deadline, and its abort controller once it runs. */
type DetailRequest = { controller?: AbortController; timer?: ReturnType<typeof setTimeout> }

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
  /** Labels for opened untracked folders in the change tree. */
  folderLabels?: ReadonlyMap<string, string>
  status: ReviewDiffView["status"]
  diffVersion?: number
  /** Loads the full patch of a previewed file whose listed patch has no hunks. */
  detail: ReviewModel["detail"]
  readFile: ReviewModel["readFile"]
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
      folderLabels={props.review.folderLabels()}
      status={props.review.diff().status}
      diffVersion={props.review.diffVersion()}
      detail={props.review.detail}
      readFile={props.review.readFile}
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
  const ctx = usePlugin<typeof Review>()

  const openIn = () => {
    const live = ctx.use(OpenInApp)()

    return live.status === "active" ? live.value : undefined
  }

  const openInButton = () => (
    <Show when={openIn()}>
      {(openIn) => <Dynamic component={openIn().Button} screen={props.screen} session={props.session} />}
    </Show>
  )

  const diffs = () => props.diffs

  const searching = createMemo(() => props.state.filter().trim().length > 0)

  // A folder row opens in the change tree; searches and the preview list files only.
  const filteredFiles = createMemo(() => {
    const files = diffs().map((diff) => diff.file)

    if (!searching()) return files

    return filterReviewFiles(
      files.filter((file) => !isReviewFolder(file)),
      props.state.filter(),
    )
  })

  const navigationFiles = createMemo(() =>
    searching() ? filteredFiles() : sortReviewPaths(filteredFiles().filter((file) => !isReviewFolder(file))),
  )

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

  // The previewed file's full patch, when its listed patch has no hunks. The request lives as long as the panel.
  const [detailState, setDetailState] = createSignal<ReviewDetailState>(INITIAL_REVIEW_DETAIL_STATE)
  const detailRequests = new Map<number, DetailRequest>()

  const dispatchDetail = (event: ReviewDetailEvent) => {
    const next = transitionReviewDetail(untrack(detailState), event)

    setDetailState(next.state)
    next.effects.forEach(runDetailEffect)
  }

  const runDetailEffect = (effect: ReviewDetailEffect) => {
    if (effect.type === "abort") {
      const request = detailRequests.get(effect.attempt)

      detailRequests.delete(effect.attempt)
      clearTimeout(request?.timer)
      request?.controller?.abort()

      return
    }

    const detail = props.detail
    const attempt = effect.attempt
    const request: DetailRequest = {}

    detailRequests.set(attempt, request)
    // A retry waits out its backoff first; the request's own deadline starts with it.
    request.timer = setTimeout(() => {
      const controller = new AbortController()

      request.controller = controller
      request.timer = setTimeout(() => dispatchDetail({ type: "fetch.timed-out", attempt }), REVIEW_DIFF_TIMEOUT_MS)
      void detail.load(effect.target, effect.stage, controller.signal).then(
        (diff) => {
          if (!detailRequests.delete(attempt)) return
          clearTimeout(request.timer)
          dispatchDetail({ type: "fetch.succeeded", attempt, diff })
        },
        (cause: unknown) => {
          if (!detailRequests.delete(attempt)) return
          clearTimeout(request.timer)
          dispatchDetail({
            type: "fetch.failed",
            attempt,
            message: cause instanceof Error ? cause.message : String(cause),
          })
        },
      )
    }, effect.delayMs)
  }

  const detailTarget = createMemo(
    () => {
      const diff = sourceActiveItem()

      if (!diff || !reviewDiffNeedsLoad(diff)) return undefined

      return props.detail.target(diff, props.diffVersion ?? 0)
    },
    undefined,
    {
      equals: (previous, next) => previous === next || (!!previous && !!next && sameReviewDetailTarget(previous, next)),
    },
  )

  // Syncs the previewed file's patch request with the file and the server's connection.
  createKeyed(
    () => ({ target: detailTarget(), connected: props.session.server.connected }),
    (current) =>
      dispatchDetail({
        type: "context.changed",
        context: current.target
          ? {
              kind: "needed",
              target: current.target,
              connected: current.connected,
              cached: props.detail.cached(current.target),
            }
          : { kind: "none" },
      }),
    { equals: (previous, next) => previous.target === next.target && previous.connected === next.connected },
  )
  onCleanup(() => dispatchDetail({ type: "disposed" }))

  const detailView = createMemo(() => {
    const target = detailTarget()

    return target ? reviewDetailView(detailState(), target) : undefined
  })

  const activeItem = () => {
    const current = detailView()

    return (current?.status === "ready" ? current.diff : undefined) ?? sourceActiveItem()
  }

  // While the full patch loads or failed, the preview keeps the file's header and shows why its diff is missing.
  const placeholder = () => {
    const current = detailView()

    if (!current || current.status === "ready") return undefined

    if (current.status === "loading") return <Loader />

    return (
      <ReviewFailure
        failure={current.status === "error" ? current.failure : undefined}
        onRetry={() => dispatchDetail({ type: "retry" })}
      />
    )
  }

  return (
    <SessionReviewV2
      title={props.title}
      stats={<DiffChanges changes={diffs()} />}
      empty={props.empty}
      sidebarOpen={props.state.sidebar.opened()}
      sidebarToggle={
        <SessionReviewV2SidebarToggle opened={props.state.sidebar.opened()} onToggle={props.state.sidebar.toggle} />
      }
      toolbarAction={openInButton()}
      sidebar={
        // Always mounted: the sidebar header hosts the changes-mode dropdown,
        // which must stay reachable when the current mode has zero diffs.
        <ReviewPanelSidebar
          screen={props.screen}
          session={props.session}
          title={props.title}
          state={props.state}
          status={props.status}
          onSelectFile={props.onSelectFile}
          diffs={diffs()}
          filteredFiles={filteredFiles()}
          searching={searching()}
          kinds={treeKinds()}
          folderLabels={props.folderLabels}
          activeDiff={activeDiff()}
          // Without diffs, the preview has no header while the tree is open.
          actions={diffs().length === 0 ? openInButton() : undefined}
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
                  placeholder={placeholder()}
                  diffStyle={props.diffStyle}
                  expandMode={props.state.expandMode()}
                  readFile={props.readFile}
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
  screen: SessionScreen
  session: MountedSession
  title?: JSX.Element
  state: ReviewPanelState
  status: ReviewDiffView["status"]
  onSelectFile: (path: string) => void
  diffs: RenderDiff[]
  filteredFiles: string[]
  searching: boolean
  kinds: ReturnType<typeof reviewDiffKinds>
  folderLabels?: ReadonlyMap<string, string>
  activeDiff: string | undefined
  actions?: JSX.Element
}) {
  const ctx = usePlugin<typeof Review>()

  // The file plugin draws the change tree; while it is unavailable the list stays empty.
  const views = () => {
    const tree = ctx.use(FileTree)()

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
      actions={props.actions}
      filter={props.state.filter()}
      onFilterChange={props.state.setFilter}
      onFilterKeyDown={onFilterKeyDown}
      width={props.state.sidebar.width()}
      onWidthChange={props.state.sidebar.resize}
      minWidth={SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN}
      maxWidth={SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX}
    >
      <Switch>
        <Match when={props.status === "loading"}>
          <div class="px-2 py-2 text-12-regular text-text-weak">
            {ctx.t("common.loading")}
            {ctx.t("common.loading.ellipsis")}
          </div>
        </Match>
        <Match when={props.status === "offline"}>
          <div class="px-2 py-2 text-12-regular text-text-weak">{ctx.t("offline")}</div>
        </Match>
        <Match when={props.status === "error"}>
          <div class="px-2 py-2 text-12-regular text-text-weak">{ctx.t("load.failed")}</div>
        </Match>
        <Match when={true}>
          <Show
            when={props.searching}
            fallback={
              <Show when={views()}>
                {(views) => (
                  <Dynamic
                    component={views().Tree}
                    screen={props.screen}
                    session={props.session}
                    allowed={props.filteredFiles}
                    kinds={props.kinds}
                    labels={props.folderLabels}
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
                    screen={props.screen}
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
        </Match>
      </Switch>
    </SessionReviewV2Sidebar>
  )
}
