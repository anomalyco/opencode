import { type SelectedLineRange } from "@pierre/diffs"
import { Show, type Accessor, type JSX } from "solid-js"
import {
  createLineCommentAnnotations,
  createLineCommentGutterRenderer,
  createLineCommentState,
  createManagedLineCommentAnnotationRenderer,
  type SavedLineComment,
  type LineCommentStateProps,
} from "../../components/line-comment-annotations"
import { useI18n } from "@bolt-ai/ui/context/i18n"
import { cloneSelectedLineRange, formatSelectedLineLabel } from "../../pierre/selection-bridge"
import { LineCommentEditorV2, LineCommentV2 } from "@bolt-ai/ui/v2/line-comment-v2"
import type { LineCommentEditorV2Mention } from "@bolt-ai/ui/v2/line-comment-v2"

type LineCommentControllerV2Props<T extends SavedLineComment> = {
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
      <div data-prevent-autofocus="" data-comment-id={view().id} onMouseDown={(event) => event.stopPropagation()}>
        <LineCommentEditor
          value={view().editor!.value}
          onInput={view().editor!.onInput}
          onCancel={view().editor!.onCancel}
          onSubmit={view().editor!.onSubmit}
          cancelLabel={view().editor!.cancelLabel}
          submitLabel={view().editor!.submitLabel}
          mention={view().editor!.mention}
        />
      </div>
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
        // A comment with actions (its menu offers Edit) also opens its editor from a click on the card.
        onOpen: props.renderCommentActions ? edit : undefined,
        get actions() {
          return props.renderCommentActions?.(comment, { edit, remove })
        },
        get editor() {
          return note.isEditing(comment.id)
            ? {
                get value() {
                  return note.draft()
                },
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
                mention: props.mention,
              }
            : undefined
        },
        onMouseEnter: () => {
          if (note.commenting()) return
          note.hoverComment(comment.selection)
        },
        onClick: () => {
          if (props.renderCommentActions || note.isEditing(comment.id)) return
          note.toggleComment(comment.id, comment.selection)
        },
      }
    },
    renderDraft: (range) => ({
      get value() {
        return note.draft()
      },
      onInput: note.setDraft,
      onCancel: () => {
        note.cancelDraft()
        note.select(null)
      },
      onSubmit: (comment) => {
        props.onSubmit({ comment, selection: cloneSelectedLineRange(range) })
        note.cancelDraft()
        note.select(null)
      },
      cancelLabel: i18n.t("ui.lineComment.cancel"),
      submitLabel: i18n.t("ui.lineComment.submit"),
      mention: props.mention,
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
    note,
    annotations,
    renderAnnotation,
    renderGutterUtility,
    onLineSelected,
    onLineSelectionEnd,
    onLineNumberSelectionEnd,
  }
}
