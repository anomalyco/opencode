type Edges = Pick<DOMRect, "left" | "top" | "right" | "bottom">

// Both DOMRect and Electron measure from the physical left, including in RTL. Electron wants DIPs, not screen pixels:
// only the window's page zoom belongs in this conversion, not the monitor's device scale factor.
export function embedBounds(rect: Edges, zoom: number) {
  const x = Math.round(rect.left * zoom)
  const y = Math.round(rect.top * zoom)

  return {
    x,
    y,
    width: Math.max(0, Math.round(rect.right * zoom) - x),
    height: Math.max(0, Math.round(rect.bottom * zoom) - y),
  }
}

export function overlaps(a: Edges, b: Edges) {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
}
