import { type SelectedLineRange } from "@pierre/diffs"
import { Show, type Accessor, type JSX } from "solid-js"
import {
  createLineCommentAnnotations,
  createLineCommentDriver,
  createLineCommentGutterRenderer,
  createManagedLineCommentAnnotationRenderer,
  type LineCommentMachine,
  type SavedLineComment,
} from "../../components/line-comment-annotations"
import { viewCommentItem } from "../../components/line-comment-machine"
import { useI18n } from "@opencode/ui/context/i18n"
import { LineCommentEditor, LineComment, type LineCommentEditorMention } from "@opencode/ui/line-comment"

type LineCommentControllerV2Props<T extends SavedLineComment> = {
  comments: Accessor<T[]>
  draftKey: Accessor<string>
  label: string
  machine?: LineCommentMachine
  onSyncSelected?: (range: SelectedLineRange | null) => void
  getSide: (range: SelectedLineRange) => "additions" | "deletions"
  onSubmit: (input: { comment: string; selection: SelectedLineRange }) => void
  onUpdate?: (input: { id: string; comment: string; selection: SelectedLineRange }) => void
  onDelete?: (comment: T) => void
  renderCommentActions?: (comment: T, controls: { edit: VoidFunction; remove: VoidFunction }) => JSX.Element
  editSubmitLabel?: string
  mention?: LineCommentEditorMention
}

type CommentProps = {
  id?: string
  comment: JSX.Element
  actions?: JSX.Element
  editor?: DraftProps
  onOpen?: VoidFunction
  onClick?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
}

type DraftProps = {
  value: string
  onInput: (value: string) => void
  onCancel: VoidFunction
  onSubmit: (value: string) => void
  cancelLabel?: string
  submitLabel?: string
  mention?: LineCommentEditorMention
}

function lineCommentElementV2(view: Accessor<CommentProps>) {
  return (
    <Show
      when={view().editor}
      fallback={
        <div
          data-prevent-autofocus=""
          data-comment-id={view().id}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={view().onClick}
          onMouseEnter={view().onMouseEnter}
        >
          <LineComment comment={view().comment} actions={view().actions} onOpen={view().onOpen} />
        </div>
      }
    >
      {(editor) => (
        <div data-prevent-autofocus="" data-comment-id={view().id} onMouseDown={(event) => event.stopPropagation()}>
          <LineCommentEditor
            value={editor().value}
            onInput={editor().onInput}
            onCancel={editor().onCancel}
            onSubmit={editor().onSubmit}
            cancelLabel={editor().cancelLabel}
            submitLabel={editor().submitLabel}
            mention={editor().mention}
          />
        </div>
      )}
    </Show>
  )
}

function lineCommentDraftElementV2(view: Accessor<DraftProps>) {
  return (
    <div data-prevent-autofocus="" onMouseDown={(event) => event.stopPropagation()}>
      <LineCommentEditor
        value={view().value}
        onInput={view().onInput}
        onCancel={view().onCancel}
        onSubmit={view().onSubmit}
        cancelLabel={view().cancelLabel}
        submitLabel={view().submitLabel}
        mention={view().mention}
      />
    </div>
  )
}

export function createLineCommentControllerV2<T extends SavedLineComment>(props: LineCommentControllerV2Props<T>) {
  const i18n = useI18n()
  const driver = createLineCommentDriver(props)

  const annotations = createLineCommentAnnotations({
    comments: props.comments,
    getCommentId: (comment) => comment.id,
    getCommentSelection: (comment) => comment.selection,
    draftRange: () => driver.view().draftRange,
    draftKey: props.draftKey,
    getSide: props.getSide,
  })

  const { renderAnnotation } = createManagedLineCommentAnnotationRenderer<T, CommentProps, DraftProps>({
    annotations,
    commentElement: lineCommentElementV2,
    draftElement: lineCommentDraftElementV2,
    renderComment: (comment) => {
      const item = () => viewCommentItem(driver.mode(), comment.id)

      const edit = () =>
        driver.send({ type: "edit.opened", id: comment.id, range: comment.selection, text: comment.comment })

      const remove = () => driver.send({ type: "comment.deleted", id: comment.id }, comment)

      return {
        id: comment.id,
        comment: comment.comment,
        // A comment with actions (its menu offers Edit) also opens its editor from a click on the card.
        onOpen: props.renderCommentActions ? edit : undefined,
        get actions() {
          return props.renderCommentActions?.(comment, { edit, remove })
        },
        get editor() {
          return item().editing
            ? {
                get value() {
                  return item().editText
                },
                onInput: (text: string) => driver.send({ type: "edit.changed", text }),
                onCancel: () => driver.send({ type: "edit.cancelled" }),
                onSubmit: (text: string) => driver.send({ type: "edit.submitted", text }),
                cancelLabel: i18n.t("ui.lineComment.cancel"),
                submitLabel: props.editSubmitLabel,
                mention: props.mention,
              }
            : undefined
        },
        onMouseEnter: () => driver.send({ type: "comment.hovered", range: comment.selection }),
        onClick: () => {
          if (props.renderCommentActions) return
          driver.send({ type: "comment.toggled", id: comment.id, range: comment.selection })
        },
      }
    },
    renderDraft: () => ({
      get value() {
        return driver.view().draftText
      },
      onInput: (text) => driver.send({ type: "draft.changed", text }),
      onCancel: () => driver.send({ type: "draft.cancelled" }),
      onSubmit: (text) => driver.send({ type: "draft.submitted", text }),
      cancelLabel: i18n.t("ui.lineComment.cancel"),
      submitLabel: i18n.t("ui.lineComment.submit"),
      mention: props.mention,
    }),
  })

  return {
    mode: driver.mode,
    selected: () => driver.view().selected,
    focusComment: driver.focusComment,
    clearPassive: driver.clearPassive,
    reset: driver.reset,
    annotations,
    renderAnnotation,
    renderGutterUtility: createLineCommentGutterRenderer({
      label: props.label,
      getSelectedRange: () => driver.view().gutterSelected,
      onOpenDraft: (range) => driver.send({ type: "draft.opened", range }),
    }),
    onLineSelected: (range: SelectedLineRange | null) => driver.send({ type: "line.selected", range }),
    onLineSelectionEnd: (range: SelectedLineRange | null) => driver.send({ type: "line.selection-ended", range }),
  }
}
