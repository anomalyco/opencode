import { type SelectedLineRange } from "@pierre/diffs"
import { type JSX } from "solid-js"
import { render as renderSolid } from "solid-js/web"
import { LineComment, LineCommentEditor } from "./line-comment"

export type LineCommentAnnotationMeta<T> =
  | { kind: "comment"; key: string; comment: T }
  | { kind: "draft"; key: string; range: SelectedLineRange }

type CommentProps = {
  id?: string
  open: boolean
  comment: JSX.Element
  selection: JSX.Element
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
}

export function createLineCommentAnnotationRenderer<T>(props: {
  renderComment: (comment: T) => CommentProps
  renderDraft: (range: SelectedLineRange) => DraftProps
}) {
  const nodes = new Map<string, VoidFunction>()

  const mount = (meta: LineCommentAnnotationMeta<T>, view: JSX.Element) => {
    if (typeof document === "undefined") return

    nodes.get(meta.key)?.()
    const host = document.createElement("div")
    const dispose = renderSolid(() => view, host)
    nodes.set(meta.key, dispose)
    return host
  }

  const render = <A extends { metadata: LineCommentAnnotationMeta<T> }>(annotation: A) => {
    const meta = annotation.metadata

    if (meta.kind === "comment") {
      const view = props.renderComment(meta.comment)
      return mount(
        meta,
        <LineComment
          inline
          id={view.id}
          open={view.open}
          comment={view.comment}
          selection={view.selection}
          onClick={view.onClick}
          onMouseEnter={view.onMouseEnter}
        />,
      )
    }

    const view = props.renderDraft(meta.range)
    return mount(
      meta,
      <LineCommentEditor
        inline
        value={view.value}
        selection={view.selection}
        onInput={view.onInput}
        onCancel={view.onCancel}
        onSubmit={view.onSubmit}
        onPopoverFocusOut={view.onPopoverFocusOut}
      />,
    )
  }

  const reconcile = <A extends { metadata: LineCommentAnnotationMeta<T> }>(annotations: A[]) => {
    const next = new Set(annotations.map((annotation) => annotation.metadata.key))
    for (const [key, dispose] of nodes) {
      if (next.has(key)) continue
      dispose()
      nodes.delete(key)
    }
  }

  const cleanup = () => {
    for (const [, dispose] of nodes) dispose()
    nodes.clear()
  }

  return { render, reconcile, cleanup }
}
