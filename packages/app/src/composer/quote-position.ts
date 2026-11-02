type Rect = { top: number; bottom: number; left: number; right: number }

/** Shared by the selection toolbar and the comment editor that replaces it. DOMRects use physical coordinates. */
export function quotePosition(
  bounds: Rect,
  extent: Rect & { short: boolean; backward: boolean },
  size: { width: number; height: number },
  docked: boolean,
) {
  const gap = 8
  const pinned = bounds.bottom - size.height - gap

  if (docked) return { top: pinned, left: (bounds.left + bounds.right - size.width) / 2 }

  const above = extent.top - size.height - gap
  const below = extent.bottom + gap
  const fitsAbove = above >= bounds.top + gap && extent.top <= bounds.bottom
  const fitsBelow = below + size.height <= bounds.bottom - gap && extent.bottom >= bounds.top

  const sides =
    extent.short || extent.backward
      ? [fitsAbove && above, fitsBelow && below]
      : [fitsBelow && below, fitsAbove && above]

  return {
    top: sides.find((side) => side !== false) ?? pinned,
    left: Math.min(
      Math.max((extent.left + extent.right - size.width) / 2, bounds.left + gap),
      Math.max(bounds.left + gap, bounds.right - size.width - gap),
    ),
  }
}
