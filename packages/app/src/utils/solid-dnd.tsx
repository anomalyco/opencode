import { useDragDropContext } from "@thisbeyond/solid-dnd"
import type { Transformer } from "@thisbeyond/solid-dnd"
import { createRoot, onCleanup, type JSXElement } from "solid-js"

type DragEvent = { draggable?: { id?: unknown } }

const isDragEvent = (event: unknown): event is DragEvent => {
  if (typeof event !== "object" || event === null) return false
  return "draggable" in event
}

export const getDraggableId = (event: unknown): string | undefined => {
  if (!isDragEvent(event)) return undefined
  const draggable = event.draggable
  if (!draggable) return undefined
  return typeof draggable.id === "string" ? draggable.id : undefined
}

const createTransformer = (id: string, axis: "x" | "y"): Transformer => ({
  id,
  order: 100,
  callback: (transform) => (axis === "x" ? { ...transform, x: 0 } : { ...transform, y: 0 }),
})

const createAxisConstraint = (axis: "x" | "y", transformerId: string) => (): JSXElement => {
  const context = useDragDropContext()
  if (!context) return null
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer = createTransformer(transformerId, axis)
  const dispose = createRoot((dispose) => {
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
    return dispose
  })
  onCleanup(dispose)
  return null
}

export const ConstrainDragXAxis = createAxisConstraint("x", "constrain-x-axis")

export const ConstrainDragYAxis = createAxisConstraint("y", "constrain-y-axis")
