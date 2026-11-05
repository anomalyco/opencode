import { getDirectory, getFilename } from "@opencode/util/path"
import type { SelectedLineRange } from "@pierre/diffs"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { FileIcon } from "@opencode/ui/file-icon"
import { useFileComponent } from "@opencode/ui/context/file"
import { useI18n } from "@opencode/ui/context/i18n"
import { mediaKindFromPath } from "../../pierre/media"
import { previewSelectedLines } from "../../pierre/selection-bridge"
import type { FileDiffInfo } from "@opencode/client/promise"
import type { PresentationFileContent, PresentationFileDiff } from "../../file-presentation"
import { children, createMemo, Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { normalize, text, type ViewDiff } from "../../components/session-diff"
import type {
  SessionReviewComment,
  SessionReviewCommentActions,
  SessionReviewCommentDelete,
  SessionReviewCommentUpdate,
  SessionReviewDiffStyle,
  SessionReviewFocus,
  SessionReviewLineComment,
} from "../../components/session-review"
import type { SessionReviewExpandMode } from "./session-review-v2"
import { createLineCommentControllerV2 } from "./line-comment-annotations-v2"
import { createReviewFocusDriver } from "../../components/review-focus-driver"
import { shouldVirtualizeReviewDiff } from "./session-review-file-preview-v2-virtualize"
import { LineCommentOverflowIcon } from "@opencode/ui/line-comment"
import { Menu } from "@opencode/ui/menu"
import "./session-review-v2.css"

type ReviewDiff = (PresentationFileDiff & { file: string }) | FileDiffInfo

export type SessionReviewFilePreviewV2Props = {
  file: string
  diff: ReviewDiff
  diffStyle: SessionReviewDiffStyle
  expandMode?: SessionReviewExpandMode
  readFile?: (path: string) => Promise<PresentationFileContent | undefined>
  onLineComment?: (comment: SessionReviewLineComment) => void
  onLineCommentUpdate?: (comment: SessionReviewCommentUpdate) => void
  onLineCommentDelete?: (comment: SessionReviewCommentDelete) => void
  lineCommentActions?: SessionReviewCommentActions
  comments?: SessionReviewComment[]
  focusedComment?: SessionReviewFocus | null
  onFocusedCommentChange?: (focus: SessionReviewFocus | null) => void
  /** Shown in place of the diff, under the file's header, while the full diff loads or after it failed to load. */
  placeholder?: JSX.Element
}

function statusLabel(status: ViewDiff["status"]) {
  if (status === "added") return "A"

  if (status === "deleted") return "D"

  return "M"
}

function statusType(status: ViewDiff["status"]) {
  if (status === "added") return "added"

  if (status === "deleted") return "deleted"

  return "modified"
}

function selectionSide(range: SelectedLineRange) {
  return range.endSide ?? range.side ?? "additions"
}

function selectionPreview(diff: ViewDiff, range: SelectedLineRange) {
  const side = selectionSide(range)
  const contents = text(diff, side)

  if (contents.length === 0) return undefined

  return previewSelectedLines(contents, range)
}

function ReviewCommentMenu(props: {
  labels: SessionReviewCommentActions
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <Menu gutter={4}>
        <Menu.Trigger
          as="button"
          type="button"
          data-slot="line-comment-v2-overflow"
          aria-label={props.labels.moreLabel}
        >
          <LineCommentOverflowIcon />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content>
            <Menu.Item onSelect={props.onEdit}>{props.labels.editLabel}</Menu.Item>
            <Menu.Item onSelect={props.onDelete}>{props.labels.deleteLabel}</Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}

export function SessionReviewFilePreviewV2(props: SessionReviewFilePreviewV2Props) {
  const i18n = useI18n()
  const fileComponent = useFileComponent()
  let scrollRef: HTMLDivElement | undefined

  const view = createMemo(() => ({
    ...normalize(props.diff),
    preloaded: "preloaded" in props.diff ? props.diff.preloaded : undefined,
  }))

  const diffCanRender = createMemo(() => view().additions !== 0 || view().deletions !== 0)
  const mediaKind = createMemo(() => mediaKindFromPath(props.file))
  const comments = createMemo(() => (props.comments ?? []).filter((comment) => comment.file === props.file))
  const commentedLines = createMemo(() => comments().map((comment) => comment.selection))
  const lineCommentsEnabled = () => props.onLineComment != null

  const commentsUi = createLineCommentControllerV2<SessionReviewComment>({
    comments,
    label: i18n.t("ui.lineComment.submit"),
    draftKey: () => props.file,
    getSide: selectionSide,
    onSubmit: ({ comment, selection }) => {
      props.onLineComment?.({
        file: props.file,
        selection,
        comment,
        preview: selectionPreview(view(), selection),
      })
    },
    onUpdate: ({ id, comment, selection }) => {
      props.onLineCommentUpdate?.({
        id,
        file: props.file,
        selection,
        comment,
        preview: selectionPreview(view(), selection),
      })
    },
    onDelete: (comment) => {
      props.onLineCommentDelete?.({
        id: comment.id,
        file: props.file,
      })
    },
    editSubmitLabel: props.lineCommentActions?.saveLabel,
    renderCommentActions: props.lineCommentActions
      ? (comment, controls) => (
          <ReviewCommentMenu labels={props.lineCommentActions!} onEdit={controls.edit} onDelete={controls.remove} />
        )
      : undefined,
  })

  const focus = createReviewFocusDriver({
    focusedComment: () => props.focusedComment,
    // A focus on another file has no comment here; settle it so it cannot hijack a later diff refresh.
    isAvailable: (target) => target.file === props.file && (diffCanRender() || !!mediaKind()),
    root: () => scrollRef,
    findComment: (_, commentId) => {
      const anchor = scrollRef?.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`)

      return anchor instanceof HTMLElement ? anchor : undefined
    },
    scrollTo: (target) => target.scrollIntoView({ block: "center" }),
    onOpenComment: (_, commentId) => {
      const comment = comments().find((item) => item.id === commentId)

      if (comment) commentsUi.focusComment(comment.id, comment.selection)
    },
    onAcknowledge: () => props.onFocusedCommentChange?.(null),
  })

  const expandUnchanged = () => props.expandMode === "expand"
  const placeholder = children(() => props.placeholder)

  const diffViewer = () => (
    <Dynamic
      component={fileComponent}
      mode="diff"
      fileDiff={view().fileDiff}
      preloadedDiff={view().preloaded}
      diffStyle={props.diffStyle}
      expandUnchanged={expandUnchanged()}
      virtualize={shouldVirtualizeReviewDiff({
        additionLines: view().fileDiff.additionLines.length,
        deletionLines: view().fileDiff.deletionLines.length,
      })}
      hunkSeparators={view().fileDiff.isPartial ? "simple" : "line-info-basic"}
      onRendered={focus.poke}
      enableLineSelection={lineCommentsEnabled()}
      enableGutterUtility={lineCommentsEnabled()}
      onLineSelected={(range: SelectedLineRange | null) => {
        if (!lineCommentsEnabled()) return
        commentsUi.onLineSelected(range)
      }}
      onLineSelectionEnd={(range: SelectedLineRange | null) => {
        if (!lineCommentsEnabled()) return
        commentsUi.onLineSelectionEnd(range)
      }}
      annotations={commentsUi.annotations()}
      renderAnnotation={commentsUi.renderAnnotation}
      renderGutterUtility={lineCommentsEnabled() ? commentsUi.renderGutterUtility : undefined}
      selectedLines={commentsUi.selected()}
      commentedLines={commentedLines()}
      media={{
        mode: "auto",
        path: props.file,
        deleted: view().status === "deleted",
        readFile: view().status === "deleted" ? undefined : props.readFile,
      }}
    />
  )

  return (
    <>
      <div data-slot="session-review-v2-file-header">
        <div data-slot="session-review-v2-file-title">
          <div data-slot="session-review-v2-file-status" data-type={statusType(view().status)}>
            {statusLabel(view().status)}
          </div>
          <FileIcon node={{ path: props.file, type: "file" }} />
          <span data-slot="session-review-v2-file-name">{getFilename(props.file)}</span>
          <Show when={props.file.includes("/")}>
            <span data-slot="session-review-v2-file-path">{getDirectory(props.file)}</span>
          </Show>
        </div>
        <div data-slot="session-review-v2-file-diff">
          <DiffChanges changes={view()} />
        </div>
      </div>
      <div
        ref={(el) => {
          scrollRef = el
        }}
        data-slot="session-review-v2-diff-scroll"
      >
        <Show when={placeholder()} fallback={
          <Show
            when={diffCanRender() || mediaKind()}
            fallback={
              <div data-slot="session-review-v2-empty">
                <span class="text-12-regular text-text-weak">{i18n.t("ui.fileMedia.binary.title")}</span>
              </div>
            }
          >
            {diffViewer()}
          </Show>
        }>
          <div data-slot="session-review-v2-empty">{placeholder()}</div>
        </Show>
      </div>
    </>
  )
}
