import { useDragDropContext } from "@thisbeyond/solid-dnd"
import { JSXElement } from "solid-js"
import type { Transformer } from "@thisbeyond/solid-dnd"

export const getDraggableId = (event: unknown): string | undefined => {
  if (typeof event !== "object" || event === null) return undefined
  if (!("draggable" in event)) return undefined
  const draggable = (event as { draggable?: { id?: unknown } }).draggable
  if (!draggable) return undefined
  return typeof draggable.id === "string" ? draggable.id : undefined
}

export const ConstrainDragXAxis = (): JSXElement => {
  const context = useDragDropContext()
  if (!context) return <></>
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = {
    id: "constrain-x-axis",
    order: 100,
    callback: (transform) => ({ ...transform, x: 0 }),
  }
  onDragStart((event) => {
    const id = getDraggableId(event)
    if (!id) return
    addTransformer("draggables", id, transformer)
  })
  onDragEnd((event) => {
    const id = getDraggableId(event)
    if (!id) return
    removeTransformer("draggables", id, transformer.id)
  })
  return <></>
}

export const ConstrainDragYAxis = (): JSXElement => {
  const context = useDragDropContext()
  if (!context) return <></>
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = {
    id: "constrain-y-axis",
    order: 100,
    callback: (transform) => ({ ...transform, y: 0 }),
  }
  onDragStart((event) => {
    const id = getDraggableId(event)
    if (!id) return
    addTransformer("draggables", id, transformer)
  })
  onDragEnd((event) => {
    const id = getDraggableId(event)
    if (!id) return
    removeTransformer("draggables", id, transformer.id)
  })
  return <></>
}
