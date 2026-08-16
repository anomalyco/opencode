import { Renderable, TargetChannel, type OptimizedBuffer } from "@opentui/core"

// Dimming an overlay by painting a translucent black fill makes opentui
// replace wide glyphs (e.g. CJK) with spaces during alpha blending, so the
// content underneath disappears while the overlay is open (opentui#837).
// Dimming the buffer's colors with a color matrix keeps every character.
export function overlayDim(alpha: number) {
  const dim = (255 - alpha) / 255
  const matrix = new Float32Array([
    dim, 0, 0, 0,
    0, dim, 0, 0,
    0, 0, dim, 0,
    0, 0, 0, 1,
  ])
  return function (this: Renderable, buffer: OptimizedBuffer, _deltaTime: number) {
    buffer.colorMatrixUniform(matrix, 1, TargetChannel.Both)
  }
}
