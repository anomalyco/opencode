import { type SelectedLineRange } from "@pierre/diffs"
import { createMemo, createSignal, type JSX } from "solid-js"
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
    if (meta.kind === "comment") {
      const view = createMemo(() => {
        const next = current()
        if (next.kind !== "comment") return props.renderComment(meta.comment)
        return props.renderComment(next.comment)
      })
      const dispose = renderSolid(
        () => (
          <LineComment
            inline
            id={view().id}
            open={view().open}
            comment={view().comment}
            selection={view().selection}
            onClick={view().onClick}
            onMouseEnter={view().onMouseEnter}
          />
        ),
        host,
      )

      const node = { host, dispose, setMeta: setCurrent }
      nodes.set(meta.key, node)
      return node
    }

    const view = createMemo(() => {
      const next = current()
      if (next.kind !== "draft") return props.renderDraft(meta.range)
      return props.renderDraft(next.range)
    })
    const dispose = renderSolid(
      () => (
        <LineCommentEditor
          inline
          value={view().value}
          selection={view().selection}
          onInput={view().onInput}
          onCancel={view().onCancel}
          onSubmit={view().onSubmit}
          onPopoverFocusOut={view().onPopoverFocusOut}
        />
      ),
      host,
    )

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
