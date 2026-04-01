import { type DiffLineAnnotation, type SelectedLineRange } from "@pierre/diffs"
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { render as renderSolid } from "solid-js/web"
import { createHoverCommentUtility } from "../pierre/comment-hover"
import { cloneSelectedLineRange, formatSelectedLineLabel, lineInSelectedRange } from "../pierre/selection-bridge"
import { LineComment, LineCommentEditor } from "./line-comment"

export type LineCommentAnnotationMeta<T> =
  | { kind: "comment"; key: string; comment: T }
  | { kind: "draft"; key: string; range: SelectedLineRange }

export type LineCommentAnnotation<T> = {
  lineNumber: number
  side?: "additions" | "deletions"
  metadata: LineCommentAnnotationMeta<T>
}

type LineCommentAnnotationsProps<T> = {
  comments: Accessor<T[]>
  getCommentId: (comment: T) => string
  getCommentSelection: (comment: T) => SelectedLineRange
  draftRange: Accessor<SelectedLineRange | null>
  draftKey: Accessor<string>
}

type LineCommentAnnotationsWithSideProps<T> = LineCommentAnnotationsProps<T> & {
  getSide: (range: SelectedLineRange) => "additions" | "deletions"
}

type HoverCommentLine = {
  lineNumber: number
  side?: "additions" | "deletions"
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

type LineCommentShape = {
  id: string
  selection: SelectedLineRange
  comment: string
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
  open: boolean
  comment: JSX.Element
  selection: JSX.Element
  actions?: JSX.Element
  editor?: DraftProps
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  onMouseEnter?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
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

export function createLineCommentAnnotationRenderer<T>(props: {
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
              <LineComment
                inline
                id={view().id}
                open={view().open}
                comment={view().comment}
                selection={view().selection}
                actions={view().actions}
                onClick={view().onClick}
                onMouseEnter={view().onMouseEnter}
              />
            }
          >
            <LineCommentEditor
              inline
              id={view().id}
              value={view().editor!.value}
              selection={view().editor!.selection}
              onInput={view().editor!.onInput}
              onCancel={view().editor!.onCancel}
              onSubmit={view().editor!.onSubmit}
              onPopoverFocusOut={view().editor!.onPopoverFocusOut}
              cancelLabel={view().editor!.cancelLabel}
              submitLabel={view().editor!.submitLabel}
            />
          </Show>
        )
      }

      const view = createMemo(() => {
        const next = current()
        if (next.kind !== "draft") return props.renderDraft(active.range)
        return props.renderDraft(next.range)
      })
      return (
        <LineCommentEditor
          inline
          value={view().value}
          selection={view().selection}
          onInput={view().onInput}
          onCancel={view().onCancel}
          onSubmit={view().onSubmit}
          onPopoverFocusOut={view().onPopoverFocusOut}
        />
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
    const next = new Set(annotations.map((annotation) => annotation.metadata.key))
    for (const [key, node] of nodes) {
      if (next.has(key)) continue
      node.dispose()
      nodes.delete(key)
    }
  }

  const cleanup = () => {
    for (const [, node] of nodes) node.dispose()
    nodes.clear()
  }

  return { render, reconcile, cleanup }
}

export function createLineCommentState<T>(props: LineCommentStateProps<T>) {
  const [draft, setDraft] = createSignal("")
  const [editing, setEditing] = createSignal<T | null>(null)

  const toRange = (range: SelectedLineRange | null) => (range ? cloneSelectedLineRange(range) : null)
  const setSelected = (range: SelectedLineRange | null) => {
    const next = toRange(range)
    props.setSelected(next)
    props.syncSelected?.(toRange(next))
    return next
  }

  const setCommenting = (range: SelectedLineRange | null) => {
    const next = toRange(range)
    props.setCommenting(next)
    return next
  }

  const closeComment = () => {
    props.setOpened(null)
  }

  const cancelDraft = () => {
    setDraft("")
    setEditing(null)
    setCommenting(null)
  }

  const reset = () => {
    setDraft("")
    setEditing(null)
    props.setOpened(null)
    props.setSelected(null)
    props.setCommenting(null)
  }

  const openComment = (id: T, range: SelectedLineRange, options?: { cancelDraft?: boolean }) => {
    if (options?.cancelDraft) cancelDraft()
    props.setOpened(id)
    setSelected(range)
  }

  const toggleComment = (id: T, range: SelectedLineRange, options?: { cancelDraft?: boolean }) => {
    if (options?.cancelDraft) cancelDraft()
    const next = props.opened() === id ? null : id
    props.setOpened(next)
    setSelected(range)
  }

  const openDraft = (range: SelectedLineRange) => {
    const next = toRange(range)
    setDraft("")
    setEditing(null)
    closeComment()
    setSelected(next)
    setCommenting(next)
  }

  const openEditor = (id: T, range: SelectedLineRange, value: string) => {
    closeComment()
    setSelected(range)
    props.setCommenting(null)
    setEditing(() => id)
    setDraft(value)
  }

  const hoverComment = (range: SelectedLineRange) => {
    const next = toRange(range)
    if (!next) return
    if (props.hoverSelected) {
      props.hoverSelected(next)
      return
    }

    setSelected(next)
  }

  const finishSelection = (range: SelectedLineRange) => {
    closeComment()
    setSelected(range)
    cancelDraft()
  }

  createEffect(() => {
    props.commenting()
    setDraft("")
  })

  return {
    draft,
    setDraft,
    editing,
    opened: props.opened,
    selected: props.selected,
    commenting: props.commenting,
    isOpen: (id: T) => props.opened() === id,
    isEditing: (id: T) => editing() === id,
    closeComment,
    openComment,
    toggleComment,
    openDraft,
    openEditor,
    hoverComment,
    cancelDraft,
    finishSelection,
    select: setSelected,
    reset,
  }
}

export function createLineCommentController<T extends LineCommentShape>(
  props: LineCommentControllerWithSideProps<T>,
): {
  note: ReturnType<typeof createLineCommentState<string>>
  annotations: Accessor<DiffLineAnnotation<LineCommentAnnotationMeta<T>>[]>
  renderAnnotation: ReturnType<typeof createManagedLineCommentAnnotationRenderer<T>>["renderAnnotation"]
  renderHoverUtility: ReturnType<typeof createLineCommentHoverRenderer>
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd: (range: SelectedLineRange | null) => void
}
export function createLineCommentController<T extends LineCommentShape>(
  props: LineCommentControllerProps<T>,
): {
  note: ReturnType<typeof createLineCommentState<string>>
  annotations: Accessor<LineCommentAnnotation<T>[]>
  renderAnnotation: ReturnType<typeof createManagedLineCommentAnnotationRenderer<T>>["renderAnnotation"]
  renderHoverUtility: ReturnType<typeof createLineCommentHoverRenderer>
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd: (range: SelectedLineRange | null) => void
}
export function createLineCommentController<T extends LineCommentShape>(
  props: LineCommentControllerProps<T> | LineCommentControllerWithSideProps<T>,
) {
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

  const { renderAnnotation } = createManagedLineCommentAnnotationRenderer<T>({
    annotations,
    renderComment: (comment) => {
      const edit = () => note.openEditor(comment.id, comment.selection, comment.comment)
      const remove = () => {
        note.reset()
        props.onDelete?.(comment)
      }

      return {
        id: comment.id,
        get open() {
          return note.isOpen(comment.id) || note.isEditing(comment.id)
        },
        comment: comment.comment,
        selection: formatSelectedLineLabel(comment.selection),
        get actions() {
          return props.renderCommentActions?.(comment, { edit, remove })
        },
        get editor() {
          return note.isEditing(comment.id)
            ? {
                get value() {
                  return note.draft()
                },
                selection: formatSelectedLineLabel(comment.selection),
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
      selection: formatSelectedLineLabel(range),
      onInput: note.setDraft,
      onCancel: note.cancelDraft,
      onSubmit: (comment) => {
        props.onSubmit({ comment, selection: cloneSelectedLineRange(range) })
        note.cancelDraft()
      },
      onPopoverFocusOut: props.onDraftPopoverFocusOut,
    }),
  })

  const renderHoverUtility = createLineCommentHoverRenderer({
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

    note.finishSelection(range)
  }

  const onLineNumberSelectionEnd = (range: SelectedLineRange | null) => {
    if (!range) return
    note.openDraft(range)
  }

  return {
    note,
    annotations,
    renderAnnotation,
    renderHoverUtility,
    onLineSelected,
    onLineSelectionEnd,
    onLineNumberSelectionEnd,
  }
}

export function createLineCommentAnnotations<T>(
  props: LineCommentAnnotationsWithSideProps<T>,
): Accessor<DiffLineAnnotation<LineCommentAnnotationMeta<T>>[]>
export function createLineCommentAnnotations<T>(
  props: LineCommentAnnotationsProps<T>,
): Accessor<LineCommentAnnotation<T>[]>
export function createLineCommentAnnotations<T>(
  props: LineCommentAnnotationsProps<T> | LineCommentAnnotationsWithSideProps<T>,
) {
  const line = (range: SelectedLineRange) => Math.max(range.start, range.end)

  if ("getSide" in props) {
    return createMemo<DiffLineAnnotation<LineCommentAnnotationMeta<T>>[]>(() => {
      const list = props.comments().map((comment) => {
        const range = props.getCommentSelection(comment)
        return {
          side: props.getSide(range),
          lineNumber: line(range),
          metadata: {
            kind: "comment",
            key: `comment:${props.getCommentId(comment)}`,
            comment,
          } satisfies LineCommentAnnotationMeta<T>,
        }
      })

      const range = props.draftRange()
      if (!range) return list

      return [
        ...list,
        {
          side: props.getSide(range),
          lineNumber: line(range),
          metadata: {
            kind: "draft",
            key: `draft:${props.draftKey()}`,
            range,
          } satisfies LineCommentAnnotationMeta<T>,
        },
      ]
    })
  }

  return createMemo<LineCommentAnnotation<T>[]>(() => {
    const list = props.comments().map((comment) => {
      const range = props.getCommentSelection(comment)
      const entry: LineCommentAnnotation<T> = {
        lineNumber: line(range),
        metadata: {
          kind: "comment",
          key: `comment:${props.getCommentId(comment)}`,
          comment,
        },
      }

      return entry
    })

    const range = props.draftRange()
    if (!range) return list

    const draft: LineCommentAnnotation<T> = {
      lineNumber: line(range),
      metadata: {
        kind: "draft",
        key: `draft:${props.draftKey()}`,
        range,
      },
    }

    return [...list, draft]
  })
}

export function createManagedLineCommentAnnotationRenderer<T>(props: {
  annotations: Accessor<LineCommentAnnotation<T>[]>
  renderComment: (comment: T) => CommentProps
  renderDraft: (range: SelectedLineRange) => DraftProps
}) {
  const renderer = createLineCommentAnnotationRenderer<T>({
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

export function createLineCommentHoverRenderer(props: {
  label: string
  getSelectedRange: Accessor<SelectedLineRange | null>
  onOpenDraft: (range: SelectedLineRange) => void
}) {
  return (getHoveredLine: () => HoverCommentLine | undefined) =>
    createHoverCommentUtility({
      label: props.label,
      getHoveredLine,
      onSelect: (hovered) => {
        const current = props.getSelectedRange()
        if (current && lineInSelectedRange(current, hovered.lineNumber, hovered.side)) {
          props.onOpenDraft(cloneSelectedLineRange(current))
          return
        }

        const range: SelectedLineRange = {
          start: hovered.lineNumber,
          end: hovered.lineNumber,
        }
        if (hovered.side) range.side = hovered.side
        props.onOpenDraft(range)
      },
    })
}
