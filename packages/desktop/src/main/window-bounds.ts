export interface WindowRect {
  x?: number
  y?: number
  width: number
  height: number
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Clamps a window rect to fit inside a display's work area: shrinks width/height that
 * overflow it, and keeps x/y inside it. When x/y are undefined (first launch, no saved
 * position) they're left undefined so Electron centers the window on its own.
 */
export function clampBoundsToWorkArea(bounds: WindowRect, workArea: WorkArea): WindowRect {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  if (bounds.x === undefined || bounds.y === undefined) return { width, height }

  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  const x = Math.min(Math.max(bounds.x, workArea.x), maxX)
  const y = Math.min(Math.max(bounds.y, workArea.y), maxY)
  return { x, y, width, height }
}

/** True when the rect no longer fits inside the work area (used to skip no-op reclamps). */
export function boundsOutsideWorkArea(bounds: WindowRect, workArea: WorkArea): boolean {
  const clamped = clampBoundsToWorkArea(bounds, workArea)
  return clamped.width !== bounds.width || clamped.height !== bounds.height || clamped.x !== bounds.x || clamped.y !== bounds.y
}
