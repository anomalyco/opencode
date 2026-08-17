import type { RGBA } from "@opentui/core"
import { blendColor } from "./core/color/style.js"

export interface OpenCodeDiagramPaletteInput {
  readonly text: RGBA
  readonly subdued: RGBA
  readonly info: RGBA
  readonly success: RGBA
  readonly warning: RGBA
  readonly background: RGBA
}

export function createOpenCodeDiagramPalette(input: OpenCodeDiagramPaletteInput) {
  return {
    text: input.text,
    primary: input.text,
    secondary: blendColor(input.text, input.subdued, 0.5),
    muted: blendColor(input.text, input.subdued, 0.7),
    warning: input.info,
    background: input.background,
    request: input.success,
    response: input.warning,
    note: input.text,
    noteBackground: blendColor(input.background, input.subdued, 0.25),
  }
}
