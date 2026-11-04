import type { DiagramPoint } from "../core/geometry.js"
import type { StateDiagramNote } from "./types.js"

interface NoteBounds {
  left: number
  top: number
  width: number
  height: number
  centerY: number
  note: StateDiagramNote
  connector?: StateDiagramNoteConnector
}

interface TargetBounds {
  left: number
  top: number
  width: number
  height: number
  centerY: number
}

export interface StateDiagramNoteConnector {
  points: readonly DiagramPoint[]
  connectorY: number
}

export function stateDiagramNoteConnector(
  bounds: NoteBounds,
  target: TargetBounds,
): StateDiagramNoteConnector {
  if (bounds.connector) return bounds.connector
  const noteX = bounds.note.position === "right" ? bounds.left - 1 : bounds.left + bounds.width
  const targetX = bounds.note.position === "right" ? target.left + target.width : target.left - 1
  const targetBottom = target.top + target.height - 1
  const noteBottom = bounds.top + bounds.height - 1
  const noteAbove = noteBottom < target.top
  const noteBelow = bounds.top > targetBottom

  if (noteAbove || noteBelow) {
    const connectorY = bounds.centerY
    return {
      connectorY,
      points: [
        { x: targetX, y: noteAbove ? target.top - 1 : targetBottom + 1 },
        { x: targetX, y: connectorY },
        { x: noteX, y: connectorY },
      ],
    }
  }

  const connectorY = Math.max(bounds.top + 1, Math.min(target.centerY, bounds.top + bounds.height - 2))
  return {
    connectorY,
    points: [
      { x: targetX, y: connectorY },
      { x: noteX, y: connectorY },
    ],
  }
}
