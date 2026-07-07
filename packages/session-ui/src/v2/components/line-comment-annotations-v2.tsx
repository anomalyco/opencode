import { type SelectedLineRange } from "@pierre/diffs"
import { Show, type Accessor, type JSX } from "solid-js"
import {
  createLineCommentAnnotations,
  createLineCommentGutterRenderer,
  createLineCommentState,
  createManagedLineCommentAnnotationRenderer,
  type LineCommentShape,
  type LineCommentStateProps,
} from "../../components/line-comment-annotations"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { cloneSelectedLineRange, formatSelectedLineLabel } from "../../pierre/selection-bridge"
import { LineCommentEditorV2, LineCommentV2 } from "@opencode-ai/ui/v2/line-comment-v2"

type LineCommentControllerV2Props<T extends LineCommentShape> = {
  comments: Accessor<T[]>
  draftKey: Accessor<string>
  label: string
  state: LineCommentStateProps<string>
  getSide: (range: SelectedLineRange) => "additions" | "deletions"
  onSubmit: (input: { comment: string; selection: SelectedLineRange }) => void
  onUpdate?: (input: { id: string; comment: string; selection: SelectedLineRange }) => void
  onDelete?: (comment: T) => void
  renderCommentActions?: (comment: T, controls: { edit: VoidFunction; remove: VoidFunction }) => JSX.Element
  editSubmitLabel?: string
}

type CommentProps = {
  id?: string
  comment: JSX.Element
  selection: JSX.Element
  actions?: JSX.Element
  editor?: DraftProps
  onClick?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
}

type DraftProps = {
  value: string
  selection: JSX.Element
  onInput: (value: string) => void
  onCancel: VoidFunction
  onSubmit: (value: string) => void
  cancelLabel?: string
  submitLabel?: string
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
          <LineCommentV2 comment={view().comment} selection={view().selection} actions={view().actions} />
        </div>
      }
    >
      <div data-prevent-autofocus="" data-comment-id={view().id} onMouseDown={(event) => event.stopPropagation()}>
        <LineCommentEditorV2
          value={view().editor!.value}
          selection={view().editor!.selection}
          onInput={view().editor!.onInput}
          onCancel={view().editor!.onCancel}
          onSubmit={view().editor!.onSubmit}
          cancelLabel={view().editor!.cancelLabel}
          submitLabel={view().editor!.submitLabel}
        />
      </div>
    </Show>
  )
}

function lineCommentDraftElementV2(view: Accessor<DraftProps>) {
  return (
    <div data-prevent-autofocus="" onMouseDown={(event) => event.stopPropagation()}>
      <LineCommentEditorV2
        value={view().value}
        selection={view().selection}
        onInput={view().onInput}
        onCancel={view().onCancel}
        onSubmit={view().onSubmit}
        cancelLabel={view().cancelLabel}
        submitLabel={view().submitLabel}
      />
    </div>
  )
}

export function createLineCommentControllerV2<T extends LineCommentShape>(props: LineCommentControllerV2Props<T>) {
  const i18n = useI18n()
  const note = createLineCommentState<string>(props.state)

  const annotations = createLineCommentAnnotations({
    comments: props.comments,
    getCommentId: (comment) => comment.id,
    getCommentSelection: (comment) => comment.selection,
    draftRange: note.commenting,
    draftKey: props.draftKey,
    getSide: props.getSide,
  })

  const { renderAnnotation } = createManagedLineCommentAnnotationRenderer<T, CommentProps, DraftProps>({
    annotations,
    commentElement: lineCommentElementV2,
    draftElement: lineCommentDraftElementV2,
    renderComment: (comment) => {
      const edit = () => note.openEditor(comment.id, comment.selection, comment.comment)
      const remove = () => {
        note.reset()
        props.onDelete?.(comment)
      }

      return {
        id: comment.id,
        comment: comment.comment,
        selection: formatSelectedLineLabel(comment.selection, i18n.t),
        get actions() {
          return props.renderCommentActions?.(comment, { edit, remove })
        },
        get editor() {
          return note.isEditing(comment.id)
            ? {
                get value() {
                  return note.draft()
                },
                selection: formatSelectedLineLabel(comment.selection, i18n.t),
                onInput: note.setDraft,
                onCancel: note.cancelDraft,
                onSubmit: (value: string) => {
                  props.onUpdate?.({
                    id: comment.id,
                    comment: value,
                    selection: cloneSelectedLineRange(comment.selection),
                  })
                  note.cancelDraft()
                },
                cancelLabel: i18n.t("ui.lineComment.cancel"),
                submitLabel: props.editSubmitLabel,
              }
            : undefined
        },
        onMouseEnter: () => note.hoverComment(comment.selection),
        onClick: () => {
          if (note.isEditing(comment.id)) return
          note.toggleComment(comment.id, comment.selection)
        },
      }
    },
    renderDraft: (range) => ({
      get value() {
        return note.draft()
      },
      selection: formatSelectedLineLabel(range, i18n.t),
      onInput: note.setDraft,
      onCancel: note.cancelDraft,
      onSubmit: (comment) => {
        props.onSubmit({ comment, selection: cloneSelectedLineRange(range) })
        note.cancelDraft()
      },
      cancelLabel: i18n.t("ui.lineComment.cancel"),
      submitLabel: i18n.t("ui.lineComment.submit"),
    }),
  })

  const renderGutterUtility = createLineCommentGutterRenderer({
    label: props.label,
    getSelectedRange: () => {
      if (note.opened()) return null
      return note.selected()
    },
    onOpenDraft: note.openDraft,
  })

  const onLineSelected = (range: SelectedLineRange | null) => {
    if (!range) {
      note.select(null)
      note.cancelDraft()
      return
    }

    note.select(range)
  }

  const onLineSelectionEnd = (range: SelectedLineRange | null) => {
    if (!range) {
      note.cancelDraft()
      return
    }

    note.openDraft(range)
  }

  const onLineNumberSelectionEnd = (range: SelectedLineRange | null) => {
    if (!range) return
    note.openDraft(range)
  }

  return {
    annotations,
    renderAnnotation,
    renderGutterUtility,
    onLineSelected,
    onLineSelectionEnd,
    onLineNumberSelectionEnd,
  }
}
