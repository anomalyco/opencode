import { type DiffLineAnnotation, type SelectedLineRange } from "@pierre/diffs"
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type Accessor, type JSX } from "solid-js"
import { render as renderSolid } from "solid-js/web"
import { useI18n } from "@opencode/ui/context/i18n"
import { createHoverComment, type HoverComment, type HoverCommentLine } from "../pierre/comment-hover"
import { cloneSelectedLineRange, formatSelectedLineLabel, lineInSelectedRange } from "../pierre/selection-bridge"
import { LineComment, LineCommentEditor, type LineCommentEditorProps } from "./line-comment"
import {
  IDLE_LINE_COMMENT_MODE,
  transitionLineComment,
  viewCommentItem,
  viewLineComment,
  type LineCommentEffect,
  type LineCommentEvent,
  type LineCommentMode,
} from "./line-comment-machine"

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

/** A line-comment mode owned by the caller, such as one file's entry in a multi-file review. Omit it to keep the mode inside the controller. */
export type LineCommentMachine = {
  mode: Accessor<LineCommentMode>
  dispatch: (event: LineCommentEvent) => readonly LineCommentEffect[]
}

export type SavedLineComment = {
  id: string
  selection: SelectedLineRange
  comment: string
}

type LineCommentDriverProps<T extends SavedLineComment> = {
  machine?: LineCommentMachine
  onSyncSelected?: (range: SelectedLineRange | null) => void
  onSubmit: (input: { comment: string; selection: SelectedLineRange }) => void
  onUpdate?: (input: { id: string; comment: string; selection: SelectedLineRange }) => void
  onDelete?: (comment: T) => void
}

type LineCommentControllerProps<T extends SavedLineComment> = LineCommentDriverProps<T> & {
  comments: Accessor<T[]>
  draftKey: Accessor<string>
  label: string
  mention?: LineCommentEditorProps["mention"]
  renderCommentActions?: (comment: T, controls: { edit: VoidFunction; remove: VoidFunction }) => JSX.Element
  editSubmitLabel?: string
  onDraftPopoverFocusOut?: (event: FocusEvent) => void
}

type LineCommentControllerWithSideProps<T extends SavedLineComment> = LineCommentControllerProps<T> & {
  getSide: (range: SelectedLineRange) => "additions" | "deletions"
}

type CommentProps = {
  id?: string
  open: boolean
  comment: JSX.Element
  selection: JSX.Element
  actions?: JSX.Element
  editor?: DraftProps
  onClick?: (event: MouseEvent) => void
  onMouseEnter?: (event: MouseEvent) => void
}

type DraftProps = {
  value: string
  selection: JSX.Element
  mention?: LineCommentEditorProps["mention"]
  onInput: (value: string) => void
  onCancel: VoidFunction
  onSubmit: (value: string) => void
  onPopoverFocusOut?: (event: FocusEvent) => void
  cancelLabel?: string
  submitLabel?: string
}

// Generic host machinery shared by the inline and panel annotation renderers: each
// annotation key gets a detached DOM host with its own Solid root, updated in
// place through a signal so Pierre can reparent the host without re-rendering.
export function createLineCommentAnnotationRenderer<T, C, D>(props: {
  renderComment: (comment: T) => C
  renderDraft: (range: SelectedLineRange) => D
  commentElement: (view: Accessor<C>) => JSX.Element
  draftElement: (view: Accessor<D>) => JSX.Element
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

        return props.commentElement(view)
      }

      const view = createMemo(() => {
        const next = current()

        if (next.kind !== "draft") return props.renderDraft(active.range)

        return props.renderDraft(next.range)
      })

      return props.draftElement(view)
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

function lineCommentElement(view: Accessor<CommentProps>) {
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
      {(editor) => (
        <LineCommentEditor
          inline
          id={view().id}
          value={editor().value}
          selection={editor().selection}
          onInput={editor().onInput}
          onCancel={editor().onCancel}
          onSubmit={editor().onSubmit}
          onPopoverFocusOut={editor().onPopoverFocusOut}
          cancelLabel={editor().cancelLabel}
          submitLabel={editor().submitLabel}
          mention={editor().mention}
        />
      )}
    </Show>
  )
}

function lineCommentDraftElement(view: Accessor<DraftProps>) {
  return (
    <LineCommentEditor
      inline
      value={view().value}
      selection={view().selection}
      onInput={view().onInput}
      onCancel={view().onCancel}
      onSubmit={view().onSubmit}
      onPopoverFocusOut={view().onPopoverFocusOut}
      mention={view().mention}
    />
  )
}

// Runs a line-comment machine and turns its effects into the controller's callbacks.
export function createLineCommentDriver<T extends SavedLineComment>(props: LineCommentDriverProps<T>) {
  const machine = props.machine ?? createLocalLineCommentMachine()

  const send = (event: LineCommentEvent, comment?: T) => {
    for (const effect of machine.dispatch(event)) {
      if (effect.type === "sync-selected")
        props.onSyncSelected?.(effect.range ? cloneSelectedLineRange(effect.range) : null)

      if (effect.type === "submit-draft") props.onSubmit({ comment: effect.comment, selection: effect.selection })

      if (effect.type === "submit-edit")
        props.onUpdate?.({ id: effect.id, comment: effect.comment, selection: effect.selection })

      if (effect.type === "delete-comment" && comment) props.onDelete?.(comment)
    }
  }

  return {
    mode: machine.mode,
    send,
    view: () => viewLineComment(machine.mode()),
    focusComment: (id: string, range: SelectedLineRange) => send({ type: "comment.focused", id, range }),
    clearPassive: () => send({ type: "passive.cleared" }),
    reset: () => send({ type: "reset" }),
  }
}

function createLocalLineCommentMachine(): LineCommentMachine {
  const [mode, setMode] = createSignal(IDLE_LINE_COMMENT_MODE)

  return {
    mode,
    dispatch: (event) => {
      const step = transitionLineComment(untrack(mode), event)
      setMode(step.state)

      return step.effects
    },
  }
}

type LineCommentController<T extends SavedLineComment, A> = {
  mode: Accessor<LineCommentMode>
  selected: Accessor<SelectedLineRange | null>
  focusComment: (id: string, range: SelectedLineRange) => void
  clearPassive: VoidFunction
  reset: VoidFunction
  annotations: Accessor<A[]>
  renderAnnotation: ReturnType<
    typeof createManagedLineCommentAnnotationRenderer<T, CommentProps, DraftProps>
  >["renderAnnotation"]
  renderGutterUtility: ReturnType<typeof createLineCommentGutterRenderer>
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
}

export function createLineCommentController<T extends SavedLineComment>(
  props: LineCommentControllerWithSideProps<T>,
): LineCommentController<T, DiffLineAnnotation<LineCommentAnnotationMeta<T>>>
export function createLineCommentController<T extends SavedLineComment>(
  props: LineCommentControllerProps<T>,
): LineCommentController<T, LineCommentAnnotation<T>>
export function createLineCommentController<T extends SavedLineComment>(
  props: LineCommentControllerProps<T> | LineCommentControllerWithSideProps<T>,
) {
  const i18n = useI18n()
  const driver = createLineCommentDriver(props)
  const draftRange = () => driver.view().draftRange

  const annotations =
    "getSide" in props
      ? createLineCommentAnnotations({
          comments: props.comments,
          getCommentId: (comment) => comment.id,
          getCommentSelection: (comment) => comment.selection,
          draftRange,
          draftKey: props.draftKey,
          getSide: props.getSide,
        })
      : createLineCommentAnnotations({
          comments: props.comments,
          getCommentId: (comment) => comment.id,
          getCommentSelection: (comment) => comment.selection,
          draftRange,
          draftKey: props.draftKey,
        })

  const { renderAnnotation } = createManagedLineCommentAnnotationRenderer<T, CommentProps, DraftProps>({
    annotations,
    commentElement: lineCommentElement,
    draftElement: lineCommentDraftElement,
    renderComment: (comment) => {
      const item = () => viewCommentItem(driver.mode(), comment.id)

      const edit = () =>
        driver.send({ type: "edit.opened", id: comment.id, range: comment.selection, text: comment.comment })

      const remove = () => driver.send({ type: "comment.deleted", id: comment.id }, comment)

      return {
        id: comment.id,
        get open() {
          return item().open
        },
        comment: comment.comment,
        selection: formatSelectedLineLabel(comment.selection, i18n.t),
        get actions() {
          return props.renderCommentActions?.(comment, { edit, remove })
        },
        get editor() {
          return item().editing
            ? {
                get value() {
                  return item().editText
                },
                selection: formatSelectedLineLabel(comment.selection, i18n.t),
                mention: props.mention,
                onInput: (text: string) => driver.send({ type: "edit.changed", text }),
                onCancel: () => driver.send({ type: "edit.cancelled" }),
                onSubmit: (text: string) => driver.send({ type: "edit.submitted", text }),
                submitLabel: props.editSubmitLabel,
              }
            : undefined
        },
        onMouseEnter: () => driver.send({ type: "comment.hovered", range: comment.selection }),
        onClick: () => driver.send({ type: "comment.toggled", id: comment.id, range: comment.selection }),
      }
    },
    renderDraft: (range) => ({
      get value() {
        return driver.view().draftText
      },
      selection: formatSelectedLineLabel(range, i18n.t),
      mention: props.mention,
      onInput: (text) => driver.send({ type: "draft.changed", text }),
      onCancel: () => driver.send({ type: "draft.cancelled" }),
      onSubmit: (text) => driver.send({ type: "draft.submitted", text }),
      onPopoverFocusOut: props.onDraftPopoverFocusOut,
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
    return createMemo<DiffLineAnnotation<LineCommentAnnotationMeta<T>>[]>(
      () => {
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
      },
      [],
      // Stable identity for unchanged annotations avoids no-op diff rerenders downstream.
      { equals: sameAnnotationLists },
    )
  }

  return createMemo<LineCommentAnnotation<T>[]>(
    () => {
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
    },
    [],
    { equals: sameAnnotationLists },
  )
}

type AnnotationListItem = {
  lineNumber: number
  side?: unknown
  metadata: { kind: string; key: string; comment?: unknown; range?: unknown }
}

function sameAnnotationLists(previous: AnnotationListItem[], next: AnnotationListItem[]) {
  if (previous.length !== next.length) return false

  return previous.every((item, index) => {
    const other = next[index]!

    return (
      item.lineNumber === other.lineNumber &&
      item.side === other.side &&
      item.metadata.kind === other.metadata.kind &&
      item.metadata.key === other.metadata.key &&
      item.metadata.comment === other.metadata.comment &&
      item.metadata.range === other.metadata.range
    )
  })
}

export function createManagedLineCommentAnnotationRenderer<T, C, D>(props: {
  annotations: Accessor<LineCommentAnnotation<T>[]>
  renderComment: (comment: T) => C
  renderDraft: (range: SelectedLineRange) => D
  commentElement: (view: Accessor<C>) => JSX.Element
  draftElement: (view: Accessor<D>) => JSX.Element
}) {
  const renderer = createLineCommentAnnotationRenderer<T, C, D>({
    renderComment: props.renderComment,
    renderDraft: props.renderDraft,
    commentElement: props.commentElement,
    draftElement: props.draftElement,
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

export function createLineCommentGutterRenderer(props: {
  label: string
  getSelectedRange: Accessor<SelectedLineRange | null>
  onOpenDraft: (range: SelectedLineRange) => void
}) {
  let active: { comment: HoverComment; getHoveredLine: () => HoverCommentLine | undefined } | undefined

  onCleanup(() => active?.comment.dispose())

  // Pierre calls this on every render and rerender but inserts the result only when it holds no button yet, so hand
  // back the same button for the same viewer instead of building one with fresh document listeners each time.
  return (getHoveredLine: () => HoverCommentLine | undefined) => {
    if (active?.getHoveredLine === getHoveredLine && active.comment.canReuse()) return active.comment.button
    active?.comment.dispose()
    const comment = createHoverComment({
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
    active = comment && { comment, getHoveredLine }

    return comment?.button
  }
}
