import { type SelectedLineRange } from "@pierre/diffs"
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { render as renderSolid } from "solid-js/web"
import {
  createLineCommentAnnotations,
  createLineCommentGutterRenderer,
  createLineCommentState,
  type LineCommentAnnotation,
  type LineCommentAnnotationMeta,
} from "../../components/line-comment-annotations"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { cloneSelectedLineRange, formatSelectedLineLabel } from "../../pierre/selection-bridge"
import { LineCommentEditorV2, LineCommentV2 } from "@opencode-ai/ui/v2/line-comment-v2"

type LineCommentShape = {
  id: string
  selection: SelectedLineRange
  comment: string
}

type LineCommentStateProps<T> = {
  opened: Accessor<T | null>
  setOpened: (id: T | null) => void
  selected: Accessor<SelectedLineRange | null>
  setSelected: (range: SelectedLineRange | null) => void
  commenting: Accessor<SelectedLineRange | null>
  setCommenting: (range: SelectedLineRange | null) => void
  syncSelected?: (range: SelectedLineRange | null) => void
  hoverSelected?: (range: SelectedLineRange) => void
}

type LineCommentControllerProps<T extends LineCommentShape> = {
  comments: Accessor<T[]>
  draftKey: Accessor<string>
  label: string
  state: LineCommentStateProps<string>
  onSubmit: (input: { comment: string; selection: SelectedLineRange }) => void
  onUpdate?: (input: { id: string; comment: string; selection: SelectedLineRange }) => void
  onDelete?: (comment: T) => void
  renderCommentActions?: (comment: T, controls: { edit: VoidFunction; remove: VoidFunction }) => JSX.Element
  editSubmitLabel?: string
  onDraftPopoverFocusOut?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  getHoverSelectedRange?: Accessor<SelectedLineRange | null>
  cancelDraftOnCommentToggle?: boolean
  clearSelectionOnSelectionEndNull?: boolean
}

type LineCommentControllerWithSideProps<T extends LineCommentShape> = LineCommentControllerProps<T> & {
  getSide: (range: SelectedLineRange) => "additions" | "deletions"
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
  onPopoverFocusOut?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  cancelLabel?: string
  submitLabel?: string
}

function createLineCommentAnnotationRendererV2<T>(props: {
  renderComment: (comment: T) => CommentProps
  renderDraft: (range: SelectedLineRange) => DraftProps
}) {
  const nodes = new Map<
    string,
    {
      host: HTMLDivElement
      dispose: VoidFunction
      setMeta: (meta: LineCommentAnnotationMeta<T>) => void
    }
  >()

  const mount = (meta: LineCommentAnnotationMeta<T>) => {
    if (typeof document === "undefined") return

    const host = document.createElement("div")
    host.setAttribute("data-prevent-autofocus", "")
    const [current, setCurrent] = createSignal(meta)

    const dispose = renderSolid(() => {
      const active = current()
      if (active.kind === "comment") {
        const view = createMemo(() => {
          const next = current()
          if (next.kind !== "comment") return props.renderComment(active.comment)
          return props.renderComment(next.comment)
        })
        return (
          <Show
            when={view().editor}
            fallback={
              <div
                data-prevent-autofocus=""
                onMouseDown={(event) => event.stopPropagation()}
                onClick={view().onClick as any}
                onMouseEnter={view().onMouseEnter as any}
              >
                <LineCommentV2
                  comment={view().comment}
                  selection={view().selection}
                  actions={view().actions}
                />
              </div>
            }
          >
            <div data-prevent-autofocus="" onMouseDown={(event) => event.stopPropagation()}>
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

      const view = createMemo(() => {
        const next = current()
        if (next.kind !== "draft") return props.renderDraft(active.range)
        return props.renderDraft(next.range)
      })
      return (
        <div data-prevent-autofocus="" onMouseDown={(event) => event.stopPropagation()}>
          <LineCommentEditorV2
            value={view().value}
            selection={view().selection}
            onInput={view().onInput}
            onCancel={view().onCancel}
            onSubmit={view().onSubmit}
          />
        </div>
      )
    }, host)

    const node = { host, dispose, setMeta: setCurrent }
    nodes.set(meta.key, node)
    return node
  }

  const render = <A extends { metadata: LineCommentAnnotationMeta<T> }>(annotation: A) => {
    const meta = annotation.metadata
    const node = nodes.get(meta.key) ?? mount(meta)
    if (!node) return
    node.setMeta(meta)
    return node.host
  }

  const reconcile = <A extends { metadata: LineCommentAnnotationMeta<T> }>(annotations: A[]) => {
    const keys = new Set(annotations.map((annotation) => annotation.metadata.key))
    for (const key of nodes.keys()) {
      if (keys.has(key)) continue
      nodes.get(key)?.dispose()
      nodes.delete(key)
    }
  }

  const cleanup = () => {
    for (const node of nodes.values()) node.dispose()
    nodes.clear()
  }

  return { render, reconcile, cleanup }
}

function createManagedLineCommentAnnotationRendererV2<T>(props: {
  annotations: Accessor<LineCommentAnnotation<T>[]>
  renderComment: (comment: T) => CommentProps
  renderDraft: (range: SelectedLineRange) => DraftProps
}) {
  const renderer = createLineCommentAnnotationRendererV2<T>({
    renderComment: props.renderComment,
    renderDraft: props.renderDraft,
  })

  createEffect(() => {
    renderer.reconcile(props.annotations())
  })

  onCleanup(() => {
    renderer.cleanup()
  })

  return {
    renderAnnotation: renderer.render,
  }
}

export function createLineCommentControllerV2<T extends LineCommentShape>(
  props: LineCommentControllerWithSideProps<T>,
): {
  annotations: ReturnType<typeof createLineCommentAnnotations<T>>
  renderAnnotation: ReturnType<typeof createManagedLineCommentAnnotationRendererV2<T>>["renderAnnotation"]
  renderGutterUtility: ReturnType<typeof createLineCommentGutterRenderer>
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd: (range: SelectedLineRange | null) => void
}
export function createLineCommentControllerV2<T extends LineCommentShape>(
  props: LineCommentControllerProps<T>,
): {
  annotations: ReturnType<typeof createLineCommentAnnotations<T>>
  renderAnnotation: ReturnType<typeof createManagedLineCommentAnnotationRendererV2<T>>["renderAnnotation"]
  renderGutterUtility: ReturnType<typeof createLineCommentGutterRenderer>
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd: (range: SelectedLineRange | null) => void
}
export function createLineCommentControllerV2<T extends LineCommentShape>(
  props: LineCommentControllerProps<T> | LineCommentControllerWithSideProps<T>,
) {
  const i18n = useI18n()
  const note = createLineCommentState<string>(props.state)

  const annotations =
    "getSide" in props
      ? createLineCommentAnnotations({
          comments: props.comments,
          getCommentId: (comment) => comment.id,
          getCommentSelection: (comment) => comment.selection,
          draftRange: note.commenting,
          draftKey: props.draftKey,
          getSide: props.getSide,
        })
      : createLineCommentAnnotations({
          comments: props.comments,
          getCommentId: (comment) => comment.id,
          getCommentSelection: (comment) => comment.selection,
          draftRange: note.commenting,
          draftKey: props.draftKey,
        })

  const { renderAnnotation } = createManagedLineCommentAnnotationRendererV2<T>({
    annotations,
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
                submitLabel: props.editSubmitLabel,
              }
            : undefined
        },
        onMouseEnter: () => note.hoverComment(comment.selection),
        onClick: () => {
          if (note.isEditing(comment.id)) return
          note.toggleComment(comment.id, comment.selection, { cancelDraft: props.cancelDraftOnCommentToggle })
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
      onPopoverFocusOut: props.onDraftPopoverFocusOut,
    }),
  })

  const renderGutterUtility = createLineCommentGutterRenderer({
    label: props.label,
    getSelectedRange: () => {
      if (note.opened()) return null
      return props.getHoverSelectedRange?.() ?? note.selected()
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
      if (props.clearSelectionOnSelectionEndNull) note.select(null)
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
