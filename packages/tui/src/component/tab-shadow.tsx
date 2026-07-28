import { RGBA, type OptimizedBuffer } from "@opentui/core"

export function drawTabShadow(
  buffer: OptimizedBuffer,
  x: number,
  y: number,
  width: number,
  color: RGBA,
  strength: number,
) {
  if (y < 0 || y >= buffer.height || width <= 0) return
  buffer.fillRect(
    Math.max(0, x),
    y,
    Math.min(width, buffer.width - Math.max(0, x)),
    1,
    RGBA.fromValues(color.r, color.g, color.b, strength),
  )
}
